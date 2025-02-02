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
  if (
    !ELEVENLABS_API_KEY ||
    !ELEVENLABS_AGENT_ID ||
    !TWILIO_ACCOUNT_SID ||
    !TWILIO_AUTH_TOKEN ||
    !TWILIO_PHONE_NUMBER
  ) {
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

  // Variables globales para el manejo de la llamada
  let globalCallSid = undefined;
  let globalName = undefined;
  let globalNumber = undefined;
  let inProgress = false;

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
          return reject(err);
        }

        connection.beginTransaction((err) => {
          if (err) {
            console.error("Error al iniciar la transacción:", err);
            connection.release();
            return reject(err);
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
                reject(err);
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
                    reject(err);
                  });
                }
                connection.release();
                resolve({ nombre, numero });
              });
            } else {
              console.log("No se encontró ningún registro.");
              connection.rollback(() => {
                connection.release();
                resolve({ nombre: null, numero: null });
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
          const nombreInsert = globalName;
          const candidato = 'no interesado';
          const fecha = new Date().toISOString();

          pool.query(
            'INSERT INTO NumerosContactadosTest (nombre, numero, candidato, tiempo, fecha) VALUES (?, ?, ?, ?, ?)',
            [nombreInsert, numero, candidato, tiempo, fecha],
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
        console.log("Número correctamente eliminado");
      }
      // Una vez eliminados, se intenta realizar la siguiente llamada
      realizarLlamada();
    });
  }

  function insertarNumeroInaccesible(numero, nombre) {
    return new Promise((resolve, reject) => {
      pool.getConnection((err, connection) => {
        if (err) {
          console.error("Error al obtener la conexión:", err);
          return reject(err);
        }
        connection.beginTransaction((err) => {
          if (err) {
            connection.release();
            return reject(err);
          }
          const fecha = new Date().toISOString();
          const query =
            "INSERT INTO NumerosInaccesiblesTest (numero, nombre, fecha) VALUES (?, ?, ?)";
          connection.query(query, [numero, nombre, fecha], (err, result) => {
            if (err) {
              connection.rollback(() => {
                connection.release();
                reject(err);
              });
            } else {
              connection.commit((err) => {
                if (err) {
                  connection.rollback(() => {
                    connection.release();
                    reject(err);
                  });
                } else {
                  connection.release();
                  resolve(result);
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

    // Iniciar el temporizador de la llamada
    startCall() {
      this.startTime = new Date();
    }

    // Finalizar la llamada y obtener el tiempo transcurrido
    endCall() {
      if (!this.startTime) {
        console.error("Error: La llamada no ha sido iniciada.");
        return null;
      }
      this.endTime = new Date();
      return this.calculateDuration();
    }

    calculateDuration() {
      if (!this.startTime || !this.endTime) {
        console.error("Error: Falta la hora de inicio o fin de la llamada.");
        return null;
      }

      const diffInMs = this.endTime - this.startTime;
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
          return reject(err);
        }

        const query = "SELECT status FROM StatusBot LIMIT 1";

        connection.query(query, (err, result) => {
          connection.release();
          if (err) {
            console.error("Error en la consulta SQL:", err);
            return reject(err);
          }

          if (result.length > 0) {
            resolve(result[0].status);
          } else {
            console.log("No se encontró ningún registro en StatusBot.");
            resolve(null);
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
    // Restablecer el flag de llamada en progreso
    inProgress = false;
    eliminarNumeros(globalNumber);
  }

  async function realizarLlamada() {
    // Control de concurrencia: si ya hay una llamada en curso, se omite la ejecución
    if (inProgress) {
      console.log("Ya hay una llamada en progreso, esperando a que termine...");
      return;
    }
    inProgress = true;

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

      // Realizar la llamada con Twilio
      const call = await twilioClient.calls.create({
        from: TWILIO_PHONE_NUMBER,
        to: formattedNumber,
        url: `https://eleventwilio.onrender.com/outbound-call-twiml`,
        statusCallback: `https://eleventwilio.onrender.com/call-status`,
        statusCallbackEvent: ["completed", "failed", "busy", "no-answer"],
        statusCallbackMethod: "POST",
        machineDetection: "DetectMessageEnd",
        timeout: 15,
        answerOnBridge: true,
      });

      globalCallSid = call.sid;
      console.log(`Llamada realizada con éxito a ${formattedNumber}`);
    } catch (error) {
      console.error("Error en la llamada:", error);

      // Manejo de errores específicos de Twilio
      if (error.code === 21215) {
        console.log(`Número no autorizado: ${globalNumber}, eliminándolo...`);
        await eliminarNumeros(globalNumber);
        // Se intenta la siguiente llamada
        return realizarLlamada();
      }

      if (error.code === "ECONNREFUSED") {
        console.log("Error de conexión con Twilio, reintentando en 5 segundos...");
        setTimeout(realizarLlamada, 5000);
      }

      console.log("Error desconocido al realizar la llamada.");
    } finally {
      inProgress = false;
    }
  }

  const timer = new CallTimer();
  handleDisconnect();

  fastify.all("/endCall", async (req, res) => {
    const { contexto } = req.body;
    console.log(contexto);
    endCall(globalCallSid);
    res.send({ success: true });
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
                return connection.rollback(() => {
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
                    res.status(201).send("Número contactado registrado correctamente");
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
    realizarLlamada();
    reply.send({ success: true });
  });

  fastify.all("/call-status", async (request, reply) => {
    try {
      const { CallSid, CallStatus, AnsweredBy, Duration } = request.body;
      if (Duration >= 1 && AnsweredBy !== "human") {
        endCall(CallSid);
      }
      switch (CallStatus) {
        case "in-progress":
          console.log("Llamada en progreso.");
          break;
        case "completed":
          console.log("Completada");
          insertarTiempo(globalName, globalNumber);
          endCall(CallSid);
          break;
        case "busy":
          console.log("Ocupado");
          insertarNumeroInaccesible(globalNumber, globalName);
          endCall(CallSid);
          break;
        case "no-answer":
          console.log("No contestó");
          insertarNumeroInaccesible(globalNumber, globalName);
          endCall(CallSid);
          break;
        case "failed":
          console.log("Llamada falló");
          insertarNumeroInaccesible(globalNumber, globalName);
          endCall(CallSid);
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
      "Eres un agente que vende punto de venta de Getnet y siempre busca cerrar una venta más. Eres amable y profesional, y siempre haces preguntas cortas para determinar si se trata de un prospecto para venta. Si es prospecto, recopila su número y nombre, mencionando que en un momento te contactarán para cerrar el proceso de venta.";

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
        // Variables para el manejo del stream
        let streamSid = null;
        let callSid = null;
        let elevenLabsWs = null;
        let customParameters = null;
        let lastAudioTimestamp = Date.now();

        ws.on("error", console.error);

        const setupElevenLabs = async () => {
          try {
            const signedUrl = await getSignedUrl();
            elevenLabsWs = new WebSocket(signedUrl);

            elevenLabsWs.on("open", () => {
              console.log("[ElevenLabs] Connected to Conversational AI");
              const initialConfig = {
                type: "conversation_initiation_client_data",
                conversation_config_override: {
                  agent: {
                    prompt: {
                      prompt: `Eres un agente que vende punto de venta de Getnet y siempre busca cerrar una venta más. Eres amable y profesional, haces preguntas cortas para determinar si se trata de un prospecto para venta. El cliente se llama ${globalName} y su número es ${globalNumber}. Si detectas contestadora automática con opciones numéricas o ausencia de audio por 10 segundos, usa el tool 'end'.`,
                    },
                    first_message:
                      "Hola, soy Karyme de Getnet. ¿Te interesaría conocer nuestra propuesta de terminal de pago?",
                  },
                },
              };

              console.log(
                "[ElevenLabs] Sending initial config with prompt:",
                initialConfig.conversation_config_override.agent.prompt.prompt
              );
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
                    console.log("Agent response", message);
                    break;
                  case "audio":
                    if (streamSid) {
                      if (message.audio?.chunk) {
                        const audioData = {
                          event: "media",
                          streamSid,
                          media: { payload: message.audio.chunk },
                        };
                        ws.send(JSON.stringify(audioData));
                      } else if (message.audio_event?.audio_base_64) {
                        const audioData = {
                          event: "media",
                          streamSid,
                          media: { payload: message.audio_event.audio_base_64 },
                        };
                        ws.send(JSON.stringify(audioData));
                      }
                    } else {
                      console.log("[ElevenLabs] Received audio but no StreamSid yet");
                    }
                    break;
                  case "interruption":
                    lastAudioTimestamp = Date.now();
                    if (streamSid) {
                      ws.send(JSON.stringify({ event: "clear", streamSid }));
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
                    console.log(`[ElevenLabs] Unhandled message type: ${message.type}`);
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

        // Manejo de mensajes de Twilio
        ws.on("message", (message) => {
          try {
            const msg = JSON.parse(message);
            console.log(`[Twilio] Received event: ${msg.event}`);
            switch (msg.event) {
              case "start":
                timer.startCall();
                inProgress = true;
                streamSid = msg.start.streamSid;
                callSid = msg.start.callSid;
                globalCallSid = msg.start.callSid;
                customParameters = msg.start.customParameters;
                console.log(`[Twilio] Stream started - StreamSid: ${streamSid}, CallSid: ${callSid}`);
                console.log("[Twilio] Start parameters:", customParameters);
                break;
              case "media":
                if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                  const audioMessage = {
                    user_audio_chunk: Buffer.from(msg.media.payload, "base64").toString("base64"),
                  };
                  elevenLabsWs.send(JSON.stringify(audioMessage));
                }
                break;
              case "stop":
                console.log(`[Twilio] Stream ${streamSid} ended`);
                if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                  elevenLabsWs.close();
                }
                if (callSid) {
                  endCall(callSid);
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
            if (globalCallSid) {
              endCall(globalCallSid);
              lastAudioTimestamp = Date.now();
            }
          }
        }, 1000);

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
