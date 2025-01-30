
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
  