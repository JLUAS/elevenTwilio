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
          return reject(err); // Rechaza la promesa si hay error al obtener conexión
        }

        connection.beginTransaction((err) => {
          if (err) {
            console.error("Error al iniciar la transacción:", err);
            connection.release();
            return reject(err); // Rechaza la promesa si hay error al iniciar transacción
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
                reject(err); // Rechaza la promesa si ocurre un error en la consulta
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
                resolve({ nombre, numero }); // Resuelve la promesa con el resultado
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

  function insertarTiempo(nombre, numero, duracion) {
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

          // Consulta para verificar si el número ya existe
          const checkQuery = `SELECT * FROM NumerosContactadosTest WHERE numero = ?`;
          connection.query(checkQuery, [numero], (err, results) => {
            if (err) {
              console.error("Error en la consulta de verificación:", err);
              return connection.rollback(() => {
                connection.release();
                reject(err);
              });
            }

            if (results.length > 0) {
              // Si el número existe, realiza el UPDATE
              const updateQuery = `UPDATE NumerosContactadosTest SET tiempo = ? WHERE numero = ?`;
              connection.query(
                updateQuery,
                [duracion, numero],
                (err, result) => {
                  if (err) {
                    console.error("Error en la consulta UPDATE:", err);
                    return connection.rollback(() => {
                      connection.release();
                      reject(err);
                    });
                  }

                  connection.commit((err) => {
                    if (err) {
                      console.error("Error al realizar commit:", err);
                      return connection.rollback(() => {
                        connection.release();
                        reject(err);
                      });
                    }

                    connection.release();
                    resolve({
                      mensaje: "Tiempo actualizado correctamente",
                      numero,
                    });
                  });
                }
              );
            } else {
              // Si el número no existe, realiza el INSERT
              const candidato = "no interesado";
              const insertQuery = `INSERT INTO NumerosContactadosTest (nombre, numero, candidato, tiempo) VALUES (?, ?, ?, ?)`;
              connection.query(
                insertQuery,
                [nombre, numero, candidato, duracion],
                (err, result) => {
                  if (err) {
                    console.error("Error en la consulta INSERT:", err);
                    return connection.rollback(() => {
                      connection.release();
                      reject(err);
                    });
                  }

                  connection.commit((err) => {
                    if (err) {
                      console.error("Error al realizar commit:", err);
                      return connection.rollback(() => {
                        connection.release();
                        reject(err);
                      });
                    }

                    connection.release();
                    resolve({
                      mensaje: "Registro insertado correctamente",
                      numero,
                    });
                  });
                }
              );
            }
          });
        });
      });
    });
  }

  function eliminarNumeros(numero) {
    const query = "DELETE FROM NuevosNumerosTest WHERE numero = ?";
    pool.query(query, [numero], (err, result) => {
      if (err) {
        console.error("Error borrando usuario:", err);
      } else {
        
      }
    });
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
          const query =
            "INSERT INTO NumerosInaccesiblesTest (numero, nombre) VALUES (?, ?)";
          connection.query(query, [numero, nombre], (err, result) => {
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
          return reject(err); // Rechaza la promesa si hay error al obtener conexión
        }

        const query = "SELECT status FROM StatusBot LIMIT 1"; // Consulta para obtener el status

        connection.query(query, (err, result) => {
          connection.release(); // Libera la conexión inmediatamente después de la consulta
          if (err) {
            console.error("Error en la consulta SQL:", err);
            return reject(err); // Rechaza la promesa si ocurre un error en la consulta
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
  const status = await getStatus();

  const timer = new CallTimer();

  handleDisconnect();

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

// ... (las importaciones y configuraciones iniciales se mantienen igual)

fastify.all("/outbound-call", async (request, reply) => {
  const status = await getStatus();
  if (status !== 1) {
    return reply.code(403).send({ error: "Las llamadas están desactivadas." });
  }

  const { nombre, numero } = await obtenerNumeros();
  if (!nombre) {
    return reply.code(400).send({ error: "No hay más números disponibles" });
  }

  const formattedNumber = nombre.startsWith('+52') ? numero : `+${numero}`;
  const prompt = "Eres un agente que vende punto de venta de Getnet y siempre busca cerrar una venta mas, eres amable y profesional, asi mismo intentas siempre hacer preguntas cortas para determinar si es o no un prospecto para venta. Tienes un objetivo, el cual es decidir si es o no un prospecto, si es un prospecto debes recopilar su numero, y su nombre, mencionandole que en un momento le contactaran para cerrar el proceso de venta.";

  try {
    const call = await twilioClient.calls.create({
      from: TWILIO_PHONE_NUMBER,
      to: formattedNumber,
      url: `https://humorous-oryx-ace.ngrok-free.app/outbound-call-twiml?prompt=${encodeURIComponent(prompt)}`,
      statusCallback: `https://humorous-oryx-ace.ngrok-free.app/call-status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed', 'busy', 'no-answer'],
      statusCallbackMethod: 'POST',
      machineDetection: 'DetectMessageEnd',
      timeout: 15,
      answerOnBridge: true
    });

    reply.send({
      success: true,
      message: "Call initiated",
      callSid: call.sid
    });
  } catch (error) {
    console.error("Error initiating outbound call:", error);
    reply.code(500).send({
      success: false,
      error: "Failed to initiate call"
    });
  }
});

fastify.all("/call-status", async (request, reply) => {
  try {
    const { CallSid, CallStatus, AnsweredBy, Duration } = request.body;
    console.log(`Estado recibido: ${CallStatus} | AnsweredBy: ${AnsweredBy}`);

    const handleInaccessibleNumber = async () => {
      const { nombre, numero } = await obtenerNumeros();
      if (nombre && numero) {
        insertarNumeroInaccesible(numero, nombre);
        eliminarNumeros(numero);
      }
    };

    // Manejar diferentes estados de llamada
    switch (CallStatus) {
      case 'answered':
        if (AnsweredBy !== 'human') {
          console.log('Llamada contestada por no humano. Colgando...');
          await twilioClient.calls(CallSid).update({ status: 'completed' });
           handleInaccessibleNumber();
        }
        break;

      case 'completed':
        if (parseInt(Duration) <= 1) { // Llamada completada inmediatamente = no contestada
          console.log('Llamada no contestada. Marcando como inaccesible');

        }
        break;

      case 'busy':
      case 'no-answer':
      case 'failed':
        console.log(`Llamada ${CallStatus}. Marcando como inaccesible`);
         handleInaccessibleNumber();
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

// ... (el resto del código de WebSocket y TwiML se mantiene igual)

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
        let customParameters = null; // Add this to store parameters

        // Handle WebSocket errors
        ws.on("error", console.error);

        // Set up ElevenLabs connection
        const setupElevenLabs = async () => {
          try {
            const { nombre, numero } = await obtenerNumeros();
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
                      prompt: `Eres un agente que vende punto de venta de Getnet y siempre busca cerrar una venta mas, eres amable y profesional, así mismo intentas siempre hacer preguntas cortas para determinar si es o no un prospecto para venta. Tienes un objetivo, el cual es decidir si es o no un prospecto, si es un prospecto debes recopilar su numero, y su nombre, mencionándole que en un momento le contactaran para cerrar el proceso de venta. El cliente se llama ${nombre}`,
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
              const duration = timer.endCall();
              if (duration >= 12000) {
                console.log("Insertar tiempo");
                eliminarNumeros(numero);
                insertarTiempo(nombre, numero, duration);
              }
            });
          } catch (error) {
            console.error("[ElevenLabs] Setup error:", error);
          }
        };

        // Set up ElevenLabs connection
        setupElevenLabs();

        // Handle messages from Twilio
        ws.on("message", (message) => {
          try {
            const msg = JSON.parse(message);
            console.log(`[Twilio] Received event: ${msg.event}`);

            switch (msg.event) {
              case "start":
                streamSid = msg.start.streamSid;
                callSid = msg.start.callSid;
                customParameters = msg.start.customParameters; // Store parameters
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
                // Finaliza la llamada con Twilio
                if (callSid) {
                  client
                    .calls(callSid)
                    .update({ status: "completed" })
                    .then((call) => console.log("Call ended:", call.sid));
                }
                break;

              default:
                console.log(`[Twilio] Unhandled event: ${msg.event}`);
            }
          } catch (error) {
            console.error("[Twilio] Error processing message:", error);
          }
        });

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
