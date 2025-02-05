import WebSocket from "ws";
import Twilio from "twilio";
import mysql from "mysql";
import axios from "axios";

export async function registerOutboundRoutes(fastify) {
  // Desestructuración de variables de entorno
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

  if (
    !ELEVENLABS_API_KEY ||
    !ELEVENLABS_AGENT_ID ||
    !TWILIO_ACCOUNT_SID ||
    !TWILIO_AUTH_TOKEN ||
    !TWILIO_PHONE_NUMBER
  ) {
    console.error("Faltan variables de entorno requeridas");
    throw new Error("Faltan variables de entorno requeridas");
  }

  const dbConfig = {
    host,
    user,
    password,
    database,
    connectionLimit: 10,
  };

  // Inicialización del cliente de Twilio
  const twilioClient = new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  let lastAudioTimestamp = null

  // Configuración del pool de MySQL
  const pool = mysql.createPool(dbConfig);

  pool.on("connection", (connection) => {
    console.log("Nueva conexión MySQL, ID:", connection.threadId);
  });
  pool.on("acquire", (connection) => {
    console.log("Conexión MySQL adquirida, ID:", connection.threadId);
  });
  pool.on("release", (connection) => {
    console.log("Conexión MySQL liberada, ID:", connection.threadId);
  });
  pool.on("error", (err) => {
    console.error("Error en MySQL:", err);
  });

  // Variable para almacenar la conexión preestablecida con ElevenLabs
  let elevenLabsWs = null;

  // Función auxiliar para obtener la URL firmada desde ElevenLabs
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
        throw new Error(`Error obteniendo signed URL: ${response.statusText}`);
      }
      const data = await response.json();
      return data.signed_url;
    } catch (error) {
      console.error("Error en getSignedUrl:", error);
      throw error;
    }
  }

  // Función para preconectar y configurar la conexión con ElevenLabs
  async function preconnectElevenLabs(callData, streamSid, ws) {
    try {
      if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
        console.log("[ElevenLabs] Usando conexión preestablecida");
        enviarConfiguracionInicial(callData);
        return elevenLabsWs;
      }
      const signedUrl = await getSignedUrl();
      elevenLabsWs = new WebSocket(signedUrl);
      elevenLabsWs.on("open", () => {
        console.log("[ElevenLabs] Conexión preestablecida");
        enviarConfiguracionInicial(callData);
      });
      elevenLabsWs.on("error", (err) => {
        console.error("[ElevenLabs] Error en conexión preestablecida:", err);
      });
      elevenLabsWs.on("message", (data) => {
        try {
          const message = JSON.parse(data);
          switch (message.type) {
            case "conversation_initiation_metadata":
              console.log("[ElevenLabs] Metadata de iniciación recibida");
              if (callData && callData.callSid && activeCalls.has(callData.callSid)) {
                activeCalls.get(callData.callSid).timer.startCall();
              }
              break;
            case "agent_response":
              console.log("Respuesta del agente:", message);
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
                console.log("[ElevenLabs] Audio recibido sin StreamSid asignado.");
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
              console.log(`[ElevenLabs] Tipo de mensaje no manejado: ${message.type}`);
          }
        } catch (error) {
          console.error("[ElevenLabs] Error procesando mensaje:", error);
        }
      });
      elevenLabsWs.on("close", () => {
        console.log("[ElevenLabs] Desconectado");
        elevenLabsWs = null;
      });
      // Espera a que la conexión se abra
      await new Promise((resolve, reject) => {
        elevenLabsWs.on("open", resolve);
        elevenLabsWs.on("error", reject);
      });
      return elevenLabsWs;
    } catch (error) {
      console.error("[ElevenLabs] Error en preconnectElevenLabs:", error);
      throw error;
    }
  }

  // Función para enviar la configuración inicial a ElevenLabs
  function enviarConfiguracionInicial(callData) {
    const initialConfig = {
      type: "conversation_initiation_client_data",
      conversation_config_override: {
        agent: {
          prompt: {
            prompt: `Eres un agente que vende punto de venta de Getnet y siempre busca cerrar una venta más. Eres amable y profesional, haces preguntas cortas para determinar si se trata de un prospecto para venta. El cliente se llama ${callData.nombre || 'desconocido'} y su número es ${callData.numero || 'desconocido'}. Si detectas contestadora automática con opciones numéricas o ausencia de audio por 10 segundos, usa el tool 'end'.`,
          },
          first_message: "Hola, soy Karyme de Getnet. ¿Te interesaría conocer nuestra propuesta de terminal de pago?",
        },
      },
    };
    console.log("[ElevenLabs] Enviando configuración inicial con prompt:", initialConfig.conversation_config_override.agent.prompt.prompt);
    if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
      elevenLabsWs.send(JSON.stringify(initialConfig));
    }
  }

  // Clase para medir la duración de la llamada
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
        console.error("Error: La llamada no se inició.");
        return null;
      }
      this.endTime = new Date();
      return this.calculateDuration();
    }
    calculateDuration() {
      if (!this.startTime || !this.endTime) {
        console.error("Error: Falta la hora de inicio o fin.");
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

  // Función para obtener el siguiente número de la base de datos
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
          connection.query(query, (err, results) => {
            if (err) {
              console.error("Error SQL en obtenerNumeros:", err);
              return connection.rollback(() => {
                connection.release();
                reject(err);
              });
            }
            if (results.length > 0) {
              const { nombre, numero } = results[0];
              connection.commit((err) => {
                if (err) {
                  console.error("Error en commit en obtenerNumeros:", err);
                  return connection.rollback(() => {
                    connection.release();
                    reject(err);
                  });
                }
                connection.release();
                resolve({ nombre, numero });
              });
            } else {
              console.log("No se encontraron registros en NuevosNumerosTest.");
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

  // Función para registrar el tiempo de llamada en NumerosContactadosTest
  function insertarTiempo(nombre, numero, tiempo) {
    pool.query(
      'SELECT * FROM NumerosContactadosTest WHERE numero = ?',
      [numero],
      (err, results) => {
        if (err) {
          console.error("Error consultando NumerosContactadosTest:", err);
          return;
        }
        if (results.length > 0) {
          pool.query(
            'UPDATE NumerosContactadosTest SET tiempo = ? WHERE numero = ?',
            [tiempo, numero],
            (err) => {
              if (err)
                console.error("Error actualizando NumerosContactadosTest:", err);
            }
          );
        } else {
          const candidato = 'no interesado';
          const fecha = new Date().toISOString();
          pool.query(
            'INSERT INTO NumerosContactadosTest (nombre, numero, candidato, tiempo, fecha) VALUES (?, ?, ?, ?, ?)',
            [nombre, numero, candidato, tiempo, fecha],
            (err) => {
              if (err)
                console.error("Error insertando en NumerosContactadosTest:", err);
            }
          );
        }
      }
    );
  }

  // Función para eliminar un número de NuevosNumerosTest
  function eliminarNumeros(numero) {
    pool.query(
      "DELETE FROM NuevosNumerosTest WHERE numero = ?",
      [numero],
      (err) => {
        if (err) {
          console.error("Error eliminando número en NuevosNumerosTest:", err);
        } else {
          console.log("Número eliminado de NuevosNumerosTest:", numero);
        }
      }
    );
  }

  // Función para insertar un número inaccesible en NumerosInaccesiblesTest (INSERT IGNORE)
  function insertarNumeroInaccesible(numero, nombre) {
    return new Promise((resolve, reject) => {
      pool.getConnection((err, connection) => {
        if (err) {
          console.error("Error obteniendo conexión en insertarNumeroInaccesible:", err);
          return reject(err);
        }
        connection.beginTransaction((err) => {
          if (err) {
            connection.release();
            return reject(err);
          }
          const fecha = new Date().toISOString();
          const query =
            "INSERT IGNORE INTO NumerosInaccesiblesTest (numero, nombre, fecha) VALUES (?, ?, ?)";
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
                  if (result.affectedRows > 0) {
                    console.log("Número insertado en NumerosInaccesiblesTest:", numero);
                  } else {
                    console.log("El número ya existía en NumerosInaccesiblesTest:", numero);
                  }
                  resolve(result);
                }
              });
            }
          });
        });
      });
    });
  }

  // Función para obtener el estado de llamadas desde StatusBot
  function getStatus() {
    return new Promise((resolve, reject) => {
      pool.getConnection((err, connection) => {
        if (err) {
          console.error("Error al obtener conexión en getStatus:", err);
          return reject(err);
        }
        const query = "SELECT status FROM StatusBot LIMIT 1";
        connection.query(query, (err, result) => {
          connection.release();
          if (err) {
            console.error("Error SQL en getStatus:", err);
            return reject(err);
          }
          if (result.length > 0) {
            resolve(result[0].status);
          } else {
            console.log("No se encontró registro en StatusBot.");
            resolve(null);
          }
        });
      });
    });
  }

  // Mapa para administrar las llamadas activas.
  // Cada entrada tendrá: { nombre, numero, timer, callSid }
  const activeCalls = new Map();

  // Función para iniciar una llamada
  async function realizarLlamada() {
    if (activeCalls.size > 0) {
      console.log("Ya hay una llamada en curso.");
      return;
    }
    lastAudioTimestamp = null
    let numeroLocal;
    try {
      const status = await getStatus();
      if (status !== 1) {
        console.log("Las llamadas están desactivadas (StatusBot).");
        return;
      }
      const { nombre, numero } = await obtenerNumeros();
      if (!nombre || !numero) {
        console.log("No hay más números disponibles para llamar.");
        return;
      }
      numeroLocal = numero;
      const formattedNumber = numero.startsWith("+52") ? numero : `+${numero}`;
      const call = await twilioClient.calls.create({
        from: TWILIO_PHONE_NUMBER,
        to: formattedNumber,
        url: `https://humorous-oryx-ace.ngrok-free.app/outbound-call-twiml`,
        statusCallback: `https://humorous-oryx-ace.ngrok-free.app/call-status`,
        statusCallbackEvent: ["completed", "failed", "busy", "no-answer"],
        statusCallbackMethod: "POST",
        machineDetection: "DetectMessageEnd",
        timeout: 15,
        answerOnBridge: true,
      });
      activeCalls.set(call.sid, { nombre, numero, timer: new CallTimer(), callSid: call.sid });
      console.log(`Llamada iniciada con éxito a ${formattedNumber}. CallSid: ${call.sid}`);
    } catch (error) {
      console.error("Error iniciando la llamada:", error);
      if (error.code === 21215) {
        console.log("Número no autorizado. Eliminando número y procediendo a la siguiente llamada.");
        eliminarNumeros(numeroLocal);
        return realizarLlamada();
      }
      if (error.code === "ECONNREFUSED") {
        console.log("Error de conexión con Twilio. Reintentando en 5 segundos...");
        setTimeout(realizarLlamada, 5000);
      }
    }
  }

  // Función centralizada para terminar y limpiar una llamada.
  async function endCall(callSid, callStatus) {
    if (!activeCalls.has(callSid)) {
      console.log(`CallSid ${callSid} no se encontró entre las llamadas activas.`);
      return;
    }
    try {
      const call = await twilioClient.calls(callSid).fetch();
      if (
        call.status !== "completed" &&
        call.status !== "failed" &&
        call.status !== "canceled"
      ) {
        await twilioClient.calls(callSid).update({ status: "completed" });
        console.log("Llamada terminada correctamente:", callSid);
      } else {
        console.log("La llamada ya se encuentra en estado terminal:", call.status);
      }
    } catch (error) {
      if (error.code === 20404) {
        console.log("La llamada no existe en los servidores de Twilio:", callSid);
      } else {
        console.error("Error terminando la llamada:", error);
      }
    } finally {
      const callData = activeCalls.get(callSid);
      if (!callData) return;
      if (callStatus === "completed") {
        const duration = callData.timer.endCall();
        insertarTiempo(callData.nombre, callData.numero, duration);
      } else if (
        ["busy", "no-answer", "failed", "canceled", "manual"].includes(callStatus)
      ) {
        try {
          await insertarNumeroInaccesible(callData.numero, callData.nombre);
        } catch (err) {
          console.error("Error insertando número inaccesible:", err);
        }
      }
      eliminarNumeros(callData.numero);
      activeCalls.delete(callSid);
      realizarLlamada();
    }
  }

  // Endpoint para finalizar manualmente una llamada.
  fastify.all("/endCall", async (req, res) => {
    const { callSid } = req.body;
    if (!callSid) {
      return res.status(400).send({ error: "Falta callSid en la petición." });
    }
    endCall(callSid, "manual");
    res.send({ success: true });
  });

  // Endpoint para registrar una llamada contactada.
  fastify.all("/register/call", async (req, res) => {
    const { nombre, numero, candidato } = req.body;
    console.log("Registrando llamada contactada:", nombre, numero, candidato);
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
                console.error("Error SQL en /register/call:", err);
                return connection.rollback(() => {
                  connection.release();
                  res.status(500).send("Error en la base de datos.");
                });
              } else {
                connection.commit((err) => {
                  if (err) {
                    connection.rollback(() => {
                      connection.release();
                      res.status(500).send(err);
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

  // Endpoint para iniciar llamadas salientes.
  fastify.all("/outbound-call", async (req, reply) => {
    realizarLlamada();
    reply.send({ success: true });
  });

  // Endpoint para manejar los callbacks de estado de llamada de Twilio.
  fastify.all("/call-status", async (req, reply) => {
    try {
      const { CallSid, CallStatus, AnsweredBy, Duration } = req.body;
      if (CallStatus === "in-progress") {
        if (Duration >= 1 && AnsweredBy !== "human") {
          console.log("Llamada no contestada por humano:", CallSid);
          endCall(CallSid, CallStatus);
        }
        return reply.send({ success: true });
      }
      switch (CallStatus) {
        case "completed":
          console.log("Llamada completada:", CallSid);
          endCall(CallSid, CallStatus);
          break;
        case "busy":
        case "no-answer":
        case "failed":
        case "canceled":
          console.log(`Estado ${CallStatus} para CallSid ${CallSid}`);
          endCall(CallSid, CallStatus);
          break;
        default:
          console.log(`Estado no manejado (${CallStatus}) para CallSid ${CallSid}`);
      }
      reply.send({ success: true });
    } catch (error) {
      console.error("Error en /call-status:", error);
      reply.code(500).send({ error: "Error interno del servidor" });
    }
  });

  // Endpoint TwiML para llamadas salientes.
  fastify.all("/outbound-call-twiml", async (req, reply) => {
    const prompt =
      "Eres un agente que vende punto de venta de Getnet y siempre busca cerrar una venta más. Eres amable y profesional, y siempre haces preguntas cortas para determinar si se trata de un prospecto para venta. Si es prospecto, recopila su número y nombre, mencionando que en un momento te contactarán para cerrar el proceso de venta.";
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Connect>
          <Stream url="wss://${req.headers.host}/outbound-media-stream">
            <Parameter name="prompt" value="${prompt}" />
          </Stream>
        </Connect>
      </Response>`;
    reply.type("text/xml").send(twimlResponse);
  });

  // Ruta WebSocket para el manejo de streams de audio de Twilio.
  fastify.register(async (fastifyInstance) => {
    fastifyInstance.get(
      "/outbound-media-stream",
      { websocket: true },
      async (ws, req) => {
        console.info("[Server] Conexión establecida con Twilio en outbound-media-stream");
        let streamSid = null;
        let callSid = null;
        let customParameters = null;
        lastAudioTimestamp = Date.now();

        ws.on("error", console.error);

        // Manejo de mensajes recibidos desde el WebSocket de Twilio
        ws.on("message", async (message) => {
          try {
            const msg = JSON.parse(message);
            console.log(`[Twilio] Evento recibido: ${msg.event}`);
            switch (msg.event) {
              case "start":
                callSid = msg.start.callSid;
                streamSid = msg.start.streamSid;
                customParameters = msg.start.customParameters;
                console.log(`[Twilio] Stream iniciado - StreamSid: ${streamSid}, CallSid: ${callSid}`);
                if (activeCalls.has(callSid)) {
                  activeCalls.get(callSid).timer.startCall();
                } else {
                  activeCalls.set(callSid, {
                    nombre: "desconocido",
                    numero: "desconocido",
                    timer: new CallTimer(),
                    callSid: callSid,
                  });
                  activeCalls.get(callSid).timer.startCall();
                }
                // Llama a preconnectElevenLabs para establecer o reutilizar la conexión y enviar la configuración inicial
                await preconnectElevenLabs(activeCalls.get(callSid), streamSid, ws);
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
                console.log(`[Twilio] Stream ${streamSid} finalizado`);
                if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                  elevenLabsWs.close();
                }
                if (callSid) {
                  endCall(callSid, "manual");
                }
                break;
              default:
                console.log(`[Twilio] Evento no manejado: ${msg.event}`);
            }
          } catch (error) {
            console.error("[Twilio] Error procesando mensaje:", error);
          }
        });

        setInterval(() => {
          if (Date.now() - lastAudioTimestamp > 20000 && activeCalls.size > 0) {
            console.log("[Detección de silencio] No se detectó audio de usuario por 20 segundos.");
            if (callSid) {
              console.log("No se detectó audio y hay callSid");
              endCall(callSid, "manual");
              lastAudioTimestamp = Date.now();
            }
          }
        }, 5000);

        ws.on("close", () => {
          console.log("[Twilio] Cliente desconectado.");
          if (elevenLabsWs?.readyState === WebSocket.OPEN) {
            elevenLabsWs.close();
          }
        });
      }
    );
  });
}
