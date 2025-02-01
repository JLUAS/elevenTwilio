import WebSocket from "ws";
import Twilio from "twilio";
import mysql from "mysql";
import axios from "axios";

export async function registerOutboundRoutes(fastify) {
  // Check for required environment variables
  const {
    ELEVENLABS_API_KEY,
    ELEVENLABS_AGENT_ID,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER,
    host,
    user,
    password,
    database,
  } = process.env;

  const dbConfig = {
    host: host,
    user: user,
    password: password,
    database: database,
    connectionLimit: 10,
  };
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.error("Missing required environment variables");
    throw new Error("Missing required environment variables");
  }
  // Initialize Twilio client
  const twilioClient = new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  // Helper function to get signed URL for authenticated conversations
  async function getSignedUrl() {
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${ELEVENLABS_AGENT_ID}`,
        {
          method: "GET",
          headers: {
            "xi-api-key": ELEVENLABS_API_KEY,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get signed URL: ${response.statusText}`);
      }

      const data = await response.json();
      return data.signed_url;
    } catch (error) {
      console.error("Error getting signed URL:", error);
      throw error;
    }
  }

  const pool = mysql.createPool(dbConfig);

  pool.on("connection", (connection) => {
    console.log("New connection established with ID:", connection.threadId);
  });

  pool.on("acquire", (connection) => {
    console.log("Connection %d acquired", connection.threadId);
  });

  pool.on("release", (connection) => {
    console.log("Connection %d released", connection.threadId);
  });

  pool.on("error", (err) => {
    console.error("MySQL error: ", err);
  });

  let globalCallSid = undefined

  let globalName = undefined

  let globalNumber = undefined

  let inProgress = undefined

  function handleDisconnect() {
    pool.getConnection((err, connection) => {
      if (err) {
        console.error("Error getting connection: ", err);
        setTimeout(handleDisconnect, 2000);
      } else {
        connection.release();
        console.log("MySQL connected");
      }
    });
  }

  function obtenerNumeros() {
    return new Promise((resolve, reject) => {
      pool.getConnection((err, connection) => {
        if (err) {
          console.error("Error al obtener la conexión:", err);
        }

        connection.beginTransaction((err) => {
          if (err) {
            console.error("Error al iniciar la transacción:", err);
            connection.release();
          }

          const query = `
            SELECT nombre, numero
            FROM NuevosNumerosTest
            ORDER BY id ASC
            LIMIT 1
          `;

          connection.query(query, (err, result) => {
            if (err) {
              console.error("Error en la consulta SQL:", err);
              return connection.rollback(() => {
                connection.release();
              });
            }

            if (result.length > 0) {
              const { nombre, numero } = result[0];
              console.log("Nombre:", nombre, "Número:", numero);
              connection.commit((err) => {
                if (err) {
                  console.error("Error al realizar commit:", err);
                  return connection.rollback(() => {
                    connection.release();
                  });
                }
                connection.release();
                resolve({ nombre, numero });
              });
            } else {
              console.log("No se encontró ningún registro.");
              connection.rollback(() => {
                connection.release();
              });
            }
          });
        });
      });
    });
  }

  function insertarTiempo(nombre, numero) {
    const tiempo = timer.endCall();
    pool.query(
      'SELECT * FROM NumerosContactadosTest WHERE numero = ?',
      [numero],
      (err, results) => {
        if (err) {
          console.error("Error al consultar en NumerosContactadosTest:", err);
          return;
        }

        if (results.length > 0) {
          pool.query(
            'UPDATE NumerosContactadosTest SET tiempo = ? WHERE numero = ?',
            [tiempo, numero],
            (err) => {
              if (err) console.error("Error insertando en NumerosContactadosTest:", err);
            }
          );
        } else {
          const nombre = llamada.nombre; 
          const candidato = 'no interesado';
          const fecha = new Date().toISOString();

          pool.query(
            'INSERT INTO NumerosContactadosTest (nombre, numero, candidato, tiempo, fecha) VALUES (?, ?, ?, ?, ?)',
            [nombre, numero, candidato, tiempo, fecha],
            (err) => {
              if (err) console.error("Error insertando en NumerosContactadosTest:", err);
            }
          );
        }
      }
    );
  }

  function eliminarNumeros(numero) {
    const query = "DELETE FROM NuevosNumerosTest WHERE numero = ?";
    pool.query(query, [numero], (err, result) => {
      if (err) {
        console.error("Error borrando usuario:", err);
      } else {
        console.log("Numero correctamente eliminado")
      }
    });
    realizarLlamada()
  }

  function insertarNumeroInaccesible(numero, nombre) {
    return new Promise((resolve, reject) => {
      pool.getConnection((err, connection) => {
        if (err) {
          console.error("Error al obtener la conexión:", err);
        }
        connection.beginTransaction((err) => {
          if (err) {
            connection.release();
          }
          const fecha = new Date().toISOString();
          const query =
            "INSERT INTO NumerosInaccesiblesTest (numero, nombre, fecha) VALUES (?, ?, ?)";
          connection.query(query, [numero, nombre, fecha], (err, result) => {
            if (err) {
              connection.rollback(() => {
                connection.release();
              });
            } else {
              connection.commit((err) => {
                if (err) {
                  connection.rollback(() => {
                    connection.release();
                  });
                } else {
                  connection.release();
                }
              });
            }
          });
        });
      });
    });
  }

  class CallTimer {
    constructor() {
      this.startTime = null;
      this.endTime = null;
    }

    // Llamar esta función al inicio de la llamada
    startCall() {
      this.startTime = new Date();
      
    }

    // Llamar esta función al finalizar la llamada
    endCall() {
      if (!this.startTime) {
        console.error("Error: La llamada no ha sido iniciada.");
        return null;
      }
      this.endTime = new Date();
      const duration = this.calculateDuration();
      return duration; // Duración en formato "hh:mm:ss"
    }

    // Calcula la duración de la llamada
    calculateDuration() {
      if (!this.startTime || !this.endTime) {
        console.error("Error: Falta la hora de inicio o fin de la llamada.");
        return null;
      }

      const diffInMs = this.endTime - this.startTime; // Diferencia en milisegundos
      const seconds = Math.floor((diffInMs / 1000) % 60);
      const minutes = Math.floor((diffInMs / (1000 * 60)) % 60);
      const hours = Math.floor((diffInMs / (1000 * 60 * 60)) % 24);

      return `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
  }

  function getStatus() {
    return new Promise((resolve, reject) => {
      pool.getConnection((err, connection) => {
        if (err) {
          console.error("Error al obtener la conexión:", err);
        }

        const query = "SELECT status FROM StatusBot LIMIT 1"; // Consulta para obtener el status

        connection.query(query, (err, result) => {
          connection.release(); // Libera la conexión inmediatamente después de la consulta
          if (err) {
            console.error("Error en la consulta SQL:", err);
          }

          if (result.length > 0) {
            resolve(result[0].status); // Resuelve la promesa con el valor de status
          } else {
            console.log("No se encontró ningún registro en StatusBot.");
            resolve(null); // Si no hay registros, resuelve con null
          }
        });
      });
    });
  }

  function endCall(callSid) {
    if (!callSid) {
      console.error("No se proporcionó un CallSid válido.");
      return;
    }
    twilioClient.calls(callSid)
      .update({ status: "completed" })
      .then(() => console.log("Llamada terminada correctamente:", callSid))
      .catch(err => console.error("Error terminando la llamada:", err));
    inProgress = false
    eliminarNumeros(globalNumber)
  }

  async function realizarLlamada() {
    try {
        const status = await getStatus();
        if (status !== 1) {
            console.log("Las llamadas están desactivadas.");
            return;
        }

        const { nombre, numero } = await obtenerNumeros();
        globalName = nombre;
        globalNumber = numero;

        if (!nombre || !numero) {
            console.log("No hay más números disponibles.");
            return;
        }

        const formattedNumber = numero.startsWith("+52") ? numero : `+${numero}`;

        // Attempt to make the call
        const call = await twilioClient.calls.create({
            from: TWILIO_PHONE_NUMBER,
            to: formattedNumber,
            url: `https://eleventwilio.onrender.com/outbound-call-twiml`,
            statusCallback: `https://eleventwilio.onrender.com/call-status`,
            statusCallbackEvent: ["completed", "failed", "busy", "no-answer"],
            statusCallbackMethod: "POST",
            machineDetection: "DetectMessageEnd",
            timeout: 15,
            answerOnBridge: true
        });

        console.log(`Llamada realizada con éxito a ${formattedNumber}`);

    } catch (error) {
        console.error("Error en la llamada:", error);

        // Handle Twilio error: Number not authorized for calls
        if (error.code === 21215) {
            console.log(`Número no autorizado: ${globalNumber}, eliminándolo...`);
            await eliminarNumeros(globalNumber);
            return realizarLlamada();  // Call next number
        }

        // Handle connection issues
        if (error.code === "ECONNREFUSED") {
            console.log("Error de conexión con Twilio, reintentando en 5 segundos...");
            setTimeout(realizarLlamada, 5000);
        }

        // Generic error handling
        console.log("Error desconocido al realizar la llamada.");
    }
}



  const timer = new CallTimer();

  handleDisconnect();

  fastify.all("/endCall", async (req, res) => {
    const{contexto}=req.body
    console.log(contexto)
    endCall(globalCallSid)
  });

  fastify.all("/register/call", async (req, res) => {
    const { nombre, numero, candidato } = req.body;
    console.log(nombre, numero, candidato);

    pool.getConnection((err, connection) => {
      if (err) return res.status(500).send(err);

      connection.beginTransaction((err) => {
        if (err) {
          connection.release();
          return res.status(500).send(err);
        }
        if (numero != 5212345678901) {
          connection.query(
            "INSERT INTO NumerosContactadosTest (nombre, numero, candidato) VALUES (?, ?, ?)",
            [nombre, numero, candidato],
            (err, result) => {
              if (err) {
                console.error("Error en la consulta SQL:", err);
                connection.rollback(() => {
                  connection.release();
                  return res.status(500).send("Error en la base de datos.");
                });
              } else {
                connection.commit((err) => {
                  if (err) {
                    connection.rollback(() => {
                      connection.release();
                      return res.status(500).send(err);
                    });
                  } else {
                    connection.release();
                    res
                      .status(201)
                      .send("Numero contactado registrado correctamente");
                  }
                });
              }
            }
          );
        }
      });
    });
  });

  fastify.all("/outbound-call", async (request, reply) => {
    realizarLlamada()
  });

  fastify.all("/call-status", async (request, reply) => {
    try {
      const { CallSid, CallStatus, AnsweredBy, Duration } = request.body;
      if(Duration >= 1 && AnsweredBy != "human"){
        endCall()
      }
      switch (CallStatus) {
        case 'in-progress':
          console.log("Llamada en progreso.")
        break;
        case 'completed':
          console.log("Completada")
          insertarTiempo(globalName,globalNumber)
          endCall(CallSid) 
        break;

        case 'busy':
          console.log("Ocupado")
          insertarNumeroInaccesible(globalName,globalNumber)
          endCall(CallSid)
        break;
        case 'no-answer':
          console.log("No contesto")
          insertarNumeroInaccesible(globalName,globalNumber)
          endCall(CallSid)
        break;
        case 'failed':
          console.log("Llamada fallo")
          insertarNumeroInaccesible(globalName,globalNumber)
          endCall(CallSid)
        break;

        default:
          console.log(`Estado no manejado: ${CallStatus}`);
      }

      reply.send({ success: true });
    } catch (error) {
      console.error("Error en /call-status:", error);
      reply.code(500).send({ error: "Error interno del servidor" });
    }
  });

  // TwiML route for outbound calls
  fastify.all("/outbound-call-twiml", async (request, reply) => {
    const prompt =
      "Eres un agente que vende punto de venta de Getnet y siempre busca cerrar una venta mas, eres amable y profesional, asi mismo intentas siempre hacer preguntas cortas para determinar si es o no un prospecto para venta. Tienes un objetivo, el cual es decidir si es o no un prospecto, si es un prospecto debes recopilar su numero, y su nombre, mencionandole que en un momento le contactaran para cerrar el proceso de venta.";

    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Connect>
          <Stream url="wss://${request.headers.host}/outbound-media-stream">
            <Parameter name="prompt" value="${prompt}" />
          </Stream>
        </Connect>
      </Response>`;

    reply.type("text/xml").send(twimlResponse);
  });

  // WebSocket route for handling media streams
  fastify.register(async (fastifyInstance) => {
    fastifyInstance.get(
      "/outbound-media-stream",
      { websocket: true },
      async (ws, req) => {
        console.info("[Server] Twilio connected to outbound media stream");
        // Variables to track the call
        let streamSid = null;
        let callSid = null;
        let elevenLabsWs = null;
        let customParameters = null;
        let lastAudioTimestamp = Date.now();

        // Handle WebSocket errors
        ws.on("error", console.error);
 
        const setupElevenLabs = async () => {
          try {

            const signedUrl = await getSignedUrl();
            elevenLabsWs = new WebSocket(signedUrl);

            elevenLabsWs.on("open", () => {
              console.log("[ElevenLabs] Connected to Conversational AI");

              // Send initial configuration with prompt and first message
              const initialConfig = {
                type: "conversation_initiation_client_data",
                conversation_config_override: {
                  agent: {
                    prompt: {
                      prompt: `Eres un agente que vende punto de venta de Getnet y siempre busca cerrar una venta mas, eres amable y profesional, así mismo intentas siempre hacer preguntas cortas para determinar si es o no un prospecto para venta. Tienes un objetivo, el cual es decidir si es o no un prospecto, si es un prospecto debes usar su numero, y su nombre, mencionándole que en un momento le contactaran para cerrar el proceso de venta. El cliente se llama ${globalName} y su numero es ${globalNumber}Si  detectas una contestadora automática con opciones numéricas o no hay ruido por 10 segundos, usa el tool 'end'`,
                    },
                    first_message:
                      "Hola soy Karyme te hablo de Getnet, y quisiera ofrecerte una de nuestras terminales, ¿te interesaría saber un poco mas sobre nuestra propuesta?",
                  },
                },
              };

              console.log(
                "[ElevenLabs] Sending initial config with prompt:",
                initialConfig.conversation_config_override.agent.prompt.prompt
              );

              // Send the configuration to ElevenLabs
              elevenLabsWs.send(JSON.stringify(initialConfig));
            });

            elevenLabsWs.on("message", (data) => {
              try {
                const message = JSON.parse(data);

                switch (message.type) {
                  case "conversation_initiation_metadata":
                    console.log("[ElevenLabs] Received initiation metadata");
                    timer.startCall();
                  break;
                  case "agent_response":
                  
                  console.log("Agent response",message)
                  break
                  case "audio":
                    if (streamSid) {
                      if (message.audio?.chunk) {
                        const audioData = {
                          event: "media",
                          streamSid,
                          media: {
                            payload: message.audio.chunk,
                          },
                        };
                        ws.send(JSON.stringify(audioData));
                      } else if (message.audio_event?.audio_base_64) {
                        const audioData = {
                          event: "media",
                          streamSid,
                          media: {
                            payload: message.audio_event.audio_base_64,
                          },
                        };
                        ws.send(JSON.stringify(audioData));
                      }
                    } else {
                      console.log(
                        "[ElevenLabs] Received audio but no StreamSid yet"
                      );
                    }
                  break;

                  case "interruption":
                    lastAudioTimestamp = Date.now();
                    if (streamSid) {
                      ws.send(
                        JSON.stringify({
                          event: "clear",
                          streamSid,
                        })
                      );
                    }
                  break;

                  case "ping":
                    if (message.ping_event?.event_id) {
                      elevenLabsWs.send(
                        JSON.stringify({
                          type: "pong",
                          event_id: message.ping_event.event_id,
                        })
                      );
                    }
                    break;

                  default:
                    console.log(
                      `[ElevenLabs] Unhandled message type: ${message.type}`
                    );
                }
              } catch (error) {
                console.error("[ElevenLabs] Error processing message:", error);
              }
            });

            elevenLabsWs.on("error", (error) => {
              console.error("[ElevenLabs] WebSocket error:", error);
            });

            elevenLabsWs.on("close", () => {
              console.log("[ElevenLabs] Disconnected");
            });
          } catch (error) {
            console.error("[ElevenLabs] Setup error:", error);
          }
        };

        setupElevenLabs();

         // Handle messages from Twilio
        ws.on("message", (message) => {
          try {
            const msg = JSON.parse(message);
            console.log(`[Twilio] Received event: ${msg.event}`);
            switch (msg.event) {
              case "start":
                timer.startCall()
                inProgress = true
                streamSid = msg.start.streamSid;
                callSid = msg.start.callSid;
                globalCallSid = msg.start.callSid;
                customParameters = msg.start.customParameters;
                console.log(
                  `[Twilio] Stream started - StreamSid: ${streamSid}, CallSid: ${callSid}`
                );
                console.log("[Twilio] Start parameters:", customParameters);
              break;

              case "media":
                if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                  const audioMessage = {
                    user_audio_chunk: Buffer.from(
                      msg.media.payload,
                      "base64"
                    ).toString("base64"),
                  };
                  elevenLabsWs.send(JSON.stringify(audioMessage));
                }
              break;

              case "stop":
                console.log(`[Twilio] Stream ${streamSid} ended`);
                if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                  elevenLabsWs.close();
                }
                if(callSid) {
                  endCall(callSid)
                }
              break;

              default:
                console.log(`[Twilio] Unhandled event: ${msg.event}`);
            }
          } catch (error) {
            console.error("[Twilio] Error processing message:", error);
          }
        });
        
        setInterval(() => {
          if (Date.now() - lastAudioTimestamp > 20000 && inProgress) {
              console.log("[Silence Detection] No user audio for 10 seconds");
              if(globalCallSid){
                endCall(globalCallSid)
                lastAudioTimestamp = Date.now();
              }
          }
        }, 1000);
        // Handle WebSocket closure
        ws.on("close", () => {
          console.log("[Twilio] Client disconnected");
          if (elevenLabsWs?.readyState === WebSocket.OPEN) {
            elevenLabsWs.close();
          }
        });
      }
    );
  });
}
