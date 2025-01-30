import WebSocket from "ws";
import Twilio from "twilio";
import mysql from "mysql";
import axios from "axios";
import fs from "fs"


export async function registerOutboundRoutes(fastify){

  const {
    ELEVENLABS_API_KEY,
    ELEVENLABS_AGENT_ID,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER,
  } = process.env;
  
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER){
    console.error("Missing required environment variables");
    throw new Error("Missing required environment variables");
  }
  
  let callSid = undefined
  
  // Conexion a base de datos
  const pool = mysql.createPool({
    host: process.env.host,
    user: process.env.user,
    password: process.env.password,
    database: process.env.database,
    connectionLimit: 20,
    queueLimit: 100
  });
  
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
  
  handleDisconnect()
  
  const twilioClient = new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

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

  function obtenerTodosLosNumeros() {
    return new Promise((resolve, reject) => {
      pool.getConnection((err, connection) => {
        if (err) return reject(err);
  
        const query = `SELECT * FROM NuevosNumeros ORDER BY id ASC`;
        
        connection.query(query, (err, results) => {
          connection.release();
          if (err) return reject(err);
          resolve(results);
        });
      });
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
            FROM NuevosNumeros   
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

  function eliminarNumeros(numero) {
    const query = "DELETE FROM NuevosNumeros    WHERE numero = ?";
    pool.query(query, [numero], (err, result) => {
      if (err) {
        console.error("Error borrando usuario:", err);
      } else {
        
      }
    });
  }

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

  let elevenLabsWs = null;

  const connectToElevenLabs = async () => {
    try {
      const signedUrl = await getSignedUrl();
      elevenLabsWs = new WebSocket(signedUrl);
      return elevenLabsWs
    } catch (error) {
      console.error("Error connecting to ElevenLabs:", error);
      throw error;
    }
  };
  // Función para leer y enviar el archivo .wav
  // const sendAudioFile = async (filePath, streamSid, ws) => {
  //   try {
  //     // Leer el archivo .wav
  //     const audioBuffer = fs.readFileSync(filePath);

  //     // Convertir el archivo a Base64
  //     const audioBase64 = audioBuffer.toString("base64");

  //     // Crear el mensaje para enviar
  //     const audioData = {
  //       event: "media",
  //       streamSid,
  //       media: {
  //         payload: audioBase64,
  //       },
  //     };

  //     ws.send(JSON.stringify(audioData));
  //     console.log(`[Audio] Archivo .wav enviado: ${filePath}`);
  //   } catch (error) {
  //     console.error("[Audio] Error enviando el archivo .wav:", error);
  //   }
  // };
  let nombreGlobal = ""
  let numeroGlobal = ""
  let callEnded = false
  const setupElevenLabs = async (streamSid, ws) => {
    try {
      elevenLabsWs.on("onopen", () => {
        console.log("[ElevenLabs] Connected to Conversational AI");
        const initialConfig = {
            type: "conversation_initiation_client_data",
            conversation_config_override: {
              agent: {
                prompt: {
                  prompt: `Eres un agente que vende punto de venta de Getnet y siempre busca cerrar una venta mas, eres amable y profesional, así mismo intentas siempre hacer preguntas cortas para determinar si es o no un prospecto para venta. Tienes un objetivo, el cual es decidir si es o no un prospecto, si es un prospecto debes usar su numero, y su nombre, mencionándole que en un momento le contactaran para cerrar el proceso de venta. El cliente se llama ${nombreGlobal} y su numero es ${numeroGlobal}`,
                },
                first_message:
                  "Hola soy Karyme te hablo de Getnet, y quisiera ofrecerte una de nuestras terminales, ¿te interesaría saber un poco mas sobre nuestra propuesta?",
              },
            },
          };
          // Send the configuration to ElevenLabs
          console.log("[ElevenLabs] Configuracion enviada")
          elevenLabsWs.send(JSON.stringify(initialConfig));
      });

      elevenLabsWs.on("message", (data) => {
        try {
          const message = JSON.parse(data);

          switch (message.type) {
            case "conversation_initiation_metadata":
              console.log("[ElevenLabs] Received initiation metadata");
            
              break;
            // case "agent_response":

            // break
            case "audio":
              if (streamSid) {
                if (message.audio?.chunk) {
                  console.log("[ElevenLabs] audio chunk")
                  const audioData = {
                    event: "media",
                    streamSid,
                    media: {
                      payload: message.audio.chunk,
                    },
                  };
                  ws.send(JSON.stringify(audioData));
                } else if (message.audio_event?.audio_base_64) {
                console.log("[ElevenLabs] audio data")
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
      });
    } catch (error) {
      console.error("[ElevenLabs] Setup error:", error);
    }
  };

  class CallTimer {
    constructor() {
      this.startTime = null;
      this.endTime = null;
    }

    startCall() {
      this.startTime = new Date();
    }

    endCall() {
      if (!this.startTime) {
        console.error("Error: La llamada no ha sido iniciada.");
        return null;
      }
      this.endTime = new Date();
      const duration = this.calculateDuration();
      return duration; // Duración en formato "hh:mm:ss"
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

  class GestorLlamadas {
    constructor() {
      this.numeros = [];
      this.enProgreso = false;
      this.indiceActual = 0;
      this.callSid = undefined
    }
  
    async iniciar() {
      if (this.enProgreso) return;
      
      try {
        if(this.numeros <= 0){
          this.numeros = await obtenerTodosLosNumeros()
          this.enProgreso= false
          this.indiceActual=0
          this.callSid=undefined
        }
        this.numeros = await obtenerTodosLosNumeros()
        this.enProgreso = true;
        this.procesarSiguiente();
      } catch (error) {
        console.error("Error obteniendo números:", error);
      }
    }
  
    async procesarSiguiente() {
      if (this.indiceActual >= this.numeros.length) {
        await gestorLlamadas.iniciar()
        this.enProgreso = false;
        if(this.callSid){
          await twilioClient.calls(this.callSid)
            .update({ status: 'completed' })
            .then(call => console.log("Llamada colgada:"))
            .catch(error => console.error("Error al colgar la llamada:", error));
        }
        this.indiceActual=0
        return;
      }
    
      const { nombre, numero } = this.numeros[this.indiceActual];
      this.indiceActual++;
    
      try {
        nombreGlobal=nombre
        numeroGlobal=numero
        await this.realizarLlamada(nombre, numero);
      } catch (error) {
        console.error(`Error en llamada a ${numero}:`, error);
        // Mover a inaccesibles si hay error

        this.procesarSiguiente();
      }
    }    
    async realizarLlamada(nombre, numero) {
      const formattedNumber = nombre.startsWith('+52') ? numero : `+${numero}`;
      await connectToElevenLabs()
      const call = await twilioClient.calls.create({
        from: TWILIO_PHONE_NUMBER,
        to: formattedNumber,
        url: `https://call-t0fi.onrender.com/outbound-call-twiml`,
        statusCallback: `https://call-t0fi.onrender.com/call-status`,
        statusCallbackEvent: ['completed', 'failed', 'busy', 'no-answer'],
        statusCallbackMethod: 'POST',
        machineDetection: 'DetectMessageEnd',
        timeout: 15,
        answerOnBridge: true
      });
  
      console.log(`Llamada iniciada a ${formattedNumber} - SID: ${call.sid}`);
      timer.startCall()
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.procesarSiguiente();
          resolve();
        }, 3000000); // Tiempo máximo de espera por llamada

        // Registrar el estado en la base de datos
      });
    }
  }

  const timer = new CallTimer();

  const gestorLlamadas = new GestorLlamadas();

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

  // Modificar el endpoint /call-status
  fastify.all("/call-status", async (request, reply) => {
    try {
      const { CallSid, CallStatus, AnsweredBy, Duration } = request.body;
      gestorLlamadas.callSid = CallSid

      if (numeroGlobal) {
        const numero = numeroGlobal;      
        
        if (['completed'].includes(CallStatus)) {
          eliminarNumeros(numero);
          const tiempo = timer.endCall();
          await twilioClient.calls(CallSid)
            .update({ status: 'completed' })
            .then(call => console.log("Llamada colgada:", call.sid))
            .catch(error => console.error("Error al colgar la llamada:", error));
      
          pool.query(
            'DELETE FROM LlamadasEnProgreso WHERE numero = ?',
            [numero],
            (err) => {
              if (err) console.error("Error eliminando llamada en progreso:", err);
            }
          );
      
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
      
          gestorLlamadas.procesarSiguiente();
        }else{
          eliminarNumeros(numero)
          await twilioClient.calls(CallSid)
            .update({ status: 'completed' })
            .then(call => console.log("Llamada colgada:", call.sid))
            .catch(error => console.error("Error al colgar la llamada:", error));
          const fecha = new Date().toISOString();
          pool.query(
            'INSERT INTO NumerosInaccesiblesTest (numero, fecha) VALUES (?,?)',
            [numero, fecha],
            (err) => {
              if (err) console.error("Error eliminando llamada en progreso:", err);
            }
          );
          gestorLlamadas.procesarSiguiente();
        }
      }
      reply.send({ success: true });
    } catch (error) {
      console.error("Error en /call-status:", error);
      reply.code(500).send({ error: "Error interno del servidor" });
    }
  });

  // Nuevo endpoint para iniciar el proceso
  fastify.all("/iniciar-llamadas", async (request, reply) => {
    try {
      await gestorLlamadas.iniciar();
      reply.send({ 
        success: true,
        message: "Proceso de llamadas iniciado",
        totalNumeros: gestorLlamadas.numeros.length
      });
    } catch (error) {
      reply.code(500).send({
        success: false,
        error: "Error al iniciar las llamadas"
      });
    }
  });

  // TwiML route for outbound calls
  fastify.all("/outbound-call-twiml", async (request, reply) => {
    const prompt =
      "Eres un agente que vende punto de venta de Getnet cuya mision es saber si es o no un prospecto.";

    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Connect>
          <Stream url="wss://${request.headers.host}/outbound-media-stream">
          </Stream>
        </Connect>
      </Response>`;

    reply.type("text/xml").send(twimlResponse);
  });

  fastify.register( (fastifyInstance) => {
    fastifyInstance.get(
      "/outbound-media-stream",
      { websocket: true },
      async (ws, req) => {

        console.info("[Server] Twilio connected to outbound media stream");
        
        let streamSid = null;
        let customParameters = null;

        // Handle WebSocket errors
        ws.on("error", console.error);

        // Handle messages from Twilio
        ws.on("message", async (message) => {
          try {
            const msg = JSON.parse(message);
            console.log(`[Twilio] Received event: ${msg.event}`);

            switch (msg.event) {
              case "connected":

                break
                case "start":
                streamSid = msg.start.streamSid;
                setupElevenLabs(streamSid, ws)
                
                callSid = msg.start.callSid;
                gestorLlamadas.callSid = msg.start.callSid
                
                console.log(
                  `[Twilio] Stream started, CallSid: ${callSid}`
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
                  twilioClient
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
            callEnded = true
            elevenLabsWs.close();
          }
        });
      }
    );
  });

}