"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  UploadCloud,
  Music,
  Mic,
  Wand2,
  Download,
  RefreshCcw,
  Globe,
} from "lucide-react";

import {
  VideoClip,
  AppMode,
} from "@/types";

import {
  renderFinalVideo,
} from "@/lib/videoEngine";

import {
  generateSpeechAndCues,
  generateViralMusic,
} from "@/lib/ttsEngine";

export default function App() {
  const [step, setStep] =
    useState(1);

  const [clips, setClips] =
    useState<VideoClip[]>([]);

  const [mode, setMode] =
    useState<AppMode | null>(null);

  const [productPrompt, setProductPrompt] =
    useState("");

  const [language, setLanguage] =
    useState("es");

  const [totalDuration, setTotalDuration] =
    useState(10);

  const [progress, setProgress] =
    useState(0);

  const [status, setStatus] =
    useState("");

  const [errorMessage, setErrorMessage] =
    useState("");

  const [finalVideo, setFinalVideo] =
    useState<string | null>(null);

  const [videoMimeType, setVideoMimeType] =
    useState("video/webm");

  const [videoExtension, setVideoExtension] =
    useState("webm");

  const fileInput =
    useRef<HTMLInputElement>(null);

  const clearClipUrls = () => {
    for (const clip of clips) {
      URL.revokeObjectURL(
        clip.url
      );
    }
  };

  useEffect(() => {
    return () => {
      for (const clip of clips) {
        URL.revokeObjectURL(
          clip.url
        );
      }

      if (finalVideo) {
        URL.revokeObjectURL(
          finalVideo
        );
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpload = async (
    files: FileList | null
  ) => {
    if (!files?.length) return;

    setErrorMessage("");

    clearClipUrls();

    if (finalVideo) {
      URL.revokeObjectURL(
        finalVideo
      );

      setFinalVideo(null);
    }

    const validClips: VideoClip[] =
      [];

    for (const file of Array.from(
      files
    )) {
      if (!file.type.startsWith("video/")) {
        continue;
      }

      const url =
        URL.createObjectURL(file);

      try {
        const duration =
          await new Promise<number>(
            (resolve, reject) => {
              const video =
                document.createElement(
                  "video"
                );

              video.preload = "metadata";
              video.muted = true;
              video.playsInline = true;

              const cleanup = () => {
                video.removeAttribute(
                  "src"
                );
                video.load();
              };

              video.onloadedmetadata =
                () => {
                  const value =
                    video.duration;

                  cleanup();

                  if (
                    !Number.isFinite(
                      value
                    ) ||
                    value <= 0
                  ) {
                    reject(
                      new Error(
                        "El vídeo no tiene una duración válida."
                      )
                    );
                    return;
                  }

                  resolve(value);
                };

              video.onerror = () => {
                cleanup();

                reject(
                  new Error(
                    "No se pudo leer uno de los vídeos."
                  )
                );
              };

              video.src = url;
            }
          );

        validClips.push({
          file,
          url,
          startOffset: 0,
          playDuration:
            duration,
        });
      } catch {
        URL.revokeObjectURL(
          url
        );
      }
    }

    if (!validClips.length) {
      setErrorMessage(
        "No se pudo cargar ningún vídeo válido."
      );

      return;
    }

    const totalUploadedDuration =
      validClips.reduce(
        (total, clip) =>
          total +
          clip.playDuration,
        0
      );

    const calculatedDuration =
      Math.min(
        15,
        Math.max(
          8,
          Math.round(
            totalUploadedDuration
          )
        )
      );

    setClips(
      validClips.sort(
        () => Math.random() - 0.5
      )
    );

    setTotalDuration(
      calculatedDuration
    );

    setStep(2);
  };

  const generateScriptLocal = (
    info: string,
    lang: string
  ): string => {
    const product =
      info
        .replace(
          /https?:\/\/\S+/gi,
          ""
        )
        .replace(/\s+/g, " ")
        .trim() ||
      "este producto";

    const scripts: Record<
      string,
      string[]
    > = {
      es: [
        `¿Sigues buscando una forma más fácil de usar ${product}? Este producto está pensado para hacerte la vida más sencilla. Es práctico, fácil de usar y perfecto para el día a día. Pruébalo y descubre lo cómodo que puede ser.`,

        `Si todavía no has probado ${product}, mira esto. Su diseño práctico te permite utilizarlo fácilmente y ahorrar tiempo en tu rutina. Descubre por qué puede convertirse en uno de tus productos favoritos.`,

        `Esto es ${product}, una opción práctica para quienes buscan comodidad y facilidad de uso. Puedes incorporarlo fácilmente a tu rutina y aprovecharlo cada día. Pruébalo ahora.`,
      ],

      en: [
        `Looking for an easier way to use ${product}? This product is designed to make your daily routine simpler. It is practical, easy to use and convenient for everyday life. Try it and see the difference.`,

        `If you have not tried ${product} yet, take a look at this. Its practical design makes it easy to use and helps simplify your routine. Discover why it could become one of your favorite products.`,

        `This is ${product}, a practical option for anyone looking for convenience and simplicity. It is easy to add to your daily routine. Try it today.`,
      ],

      pt: [
        `Procurando uma forma mais fácil de usar ${product}? Este produto foi pensado para tornar sua rotina mais simples. É prático, fácil de usar e perfeito para o dia a dia. Experimente e veja a diferença.`,

        `Se você ainda não conhece ${product}, olha isso. Seu design prático facilita o uso e ajuda a simplificar sua rotina. Descubra por que ele pode se tornar um dos seus produtos favoritos.`,

        `Este é ${product}, uma opção prática para quem procura mais comodidade. É fácil de usar e pode fazer parte da sua rotina todos os dias. Experimente agora.`,
      ],

      fr: [
        `Vous cherchez une façon plus simple d'utiliser ${product} ? Ce produit est conçu pour faciliter votre quotidien. Il est pratique, facile à utiliser et idéal pour tous les jours. Essayez-le et découvrez la différence.`,

        `Vous n'avez pas encore essayé ${product} ? Regardez ceci. Son design pratique permet une utilisation simple et facilite votre routine. Découvrez pourquoi il pourrait devenir l'un de vos produits préférés.`,

        `Voici ${product}, une solution pratique pour ceux qui recherchent plus de simplicité. Il est facile à utiliser et à intégrer dans votre quotidien. Essayez-le dès maintenant.`,
      ],
    };

    const options =
      scripts[lang] ||
      scripts.es;

    return options[
      Math.floor(
        Math.random() *
          options.length
      )
    ];
  };

  const processVideo = async () => {
    if (!clips.length) {
      setErrorMessage(
        "Primero sube al menos un vídeo."
      );
      return;
    }

    if (!mode) {
      setErrorMessage(
        "Selecciona un modo de vídeo."
      );
      return;
    }

    setErrorMessage("");
    setStep(4);
    setProgress(0);

    try {
      let audioBlob: Blob | null =
        null;

      let wordChunks: string[] =
        [];

      if (mode === "voice") {
        setStatus(
          `Generando voz en ${language.toUpperCase()}...`
        );
        setProgress(10);

        const script =
          generateScriptLocal(
            productPrompt,
            language
          );

        const speech =
          await generateSpeechAndCues(
            script,
            language
          );

        audioBlob =
          speech.audioBlob;

        wordChunks =
          speech.wordChunks;

        setProgress(30);
        setStatus(
          "Voz generada. Preparando vídeo..."
        );
      } else {
        setStatus(
          "Generando música..."
        );

        setProgress(10);

        audioBlob =
          await generateViralMusic(
            totalDuration
          );

        setProgress(30);
        setStatus(
          "Música generada. Preparando vídeo..."
        );
      }

      setStatus(
        "Renderizando vídeo final..."
      );

      const result =
        await renderFinalVideo({
          clips,
          audioBlob,
          wordChunks,
          mode,
          targetDuration:
            totalDuration,
          onProgress: (
            renderProgress
          ) => {
            const overall =
              30 +
              Math.round(
                renderProgress *
                  0.7
              );

            setProgress(
              Math.min(
                100,
                overall
              )
            );
          },
        });

      setVideoMimeType(
        result.mimeType
      );

      setVideoExtension(
        result.extension
      );

      setFinalVideo(
        result.url
      );

      setProgress(100);
      setStatus(
        "Vídeo terminado."
      );

      setStep(5);
    } catch (error) {
      console.error(
        "[VIDEO GENERATION ERROR]",
        error
      );

      const message =
        error instanceof Error
          ? error.message
          : "Ocurrió un error desconocido.";

      setErrorMessage(message);
      setStatus("");

      setProgress(0);
      setStep(3);
    }
  };

  const resetAll = () => {
    clearClipUrls();

    if (finalVideo) {
      URL.revokeObjectURL(
        finalVideo
      );
    }

    setClips([]);
    setFinalVideo(null);
    setMode(null);
    setProductPrompt("");
    setProgress(0);
    setStatus("");
    setErrorMessage("");
    setStep(1);
  };

  return (
    <main className="min-h-[100dvh] bg-[#09090b] text-white flex flex-col items-center justify-center p-4 sm:p-6 overflow-x-hidden">
      <div className="w-full max-w-xl text-center mb-6 sm:mb-8 mt-4">
        <div className="inline-block bg-purple-500/10 border border-purple-500/30 text-purple-400 px-3 py-1 rounded-full text-[10px] sm:text-xs font-bold mb-3 sm:mb-4 tracking-widest">
          TIKTOK AUTOMATOR
        </div>

        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black bg-gradient-to-br from-white to-zinc-500 bg-clip-text text-transparent leading-tight">
          Creador Viral
        </h1>
      </div>

      <div className="w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-3xl sm:rounded-[2rem] p-5 sm:p-8 shadow-2xl relative overflow-hidden">
        
        {errorMessage && (
          <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {errorMessage}
          </div>
        )}

        {step === 1 && (
          <div
            onClick={() =>
              fileInput.current?.click()
            }
            className="border-2 border-dashed border-zinc-700 hover:border-purple-500 bg-zinc-950/50 rounded-2xl sm:rounded-3xl p-8 sm:p-12 flex flex-col items-center cursor-pointer transition-all active:scale-95 touch-manipulation"
          >
            <input
              type="file"
              ref={fileInput}
              onChange={(event) =>
                handleUpload(
                  event.target.files
                )
              }
              multiple
              accept="video/*"
              className="hidden"
            />

            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-zinc-800 rounded-full flex items-center justify-center mb-4">
              <UploadCloud className="w-8 h-8 sm:w-10 sm:h-10 text-purple-400" />
            </div>

            <h2 className="text-lg sm:text-xl font-bold text-center">
              Toca para subir vídeos
            </h2>

            <p className="text-zinc-500 text-sm mt-2 text-center">
              Puedes seleccionar varios
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg sm:text-xl font-bold mb-4">
              ¿Qué formato quieres crear?
            </h2>

            <button
              onClick={() => {
                setMode("music");
                setErrorMessage("");
                setStep(3);
              }}
              className="w-full p-4 sm:p-6 bg-zinc-950 border border-zinc-800 rounded-2xl flex items-center gap-4 hover:border-blue-500 active:bg-blue-900/20 transition-all"
            >
              <div className="p-3 sm:p-4 bg-blue-500/10 rounded-full shrink-0">
                <Music className="text-blue-400 w-6 h-6" />
              </div>

              <div className="text-left">
                <h3 className="font-bold text-base sm:text-lg">
                  Modo Musical
                </h3>

                <p className="text-zinc-500 text-xs sm:text-sm">
                  Cortes rápidos + música.
                </p>
              </div>
            </button>

            <button
              onClick={() => {
                setMode("voice");
                setErrorMessage("");
                setStep(3);
              }}
              className="w-full p-4 sm:p-6 bg-zinc-950 border border-zinc-800 rounded-2xl flex items-center gap-4 hover:border-purple-500 active:bg-purple-900/20 transition-all"
            >
              <div className="p-3 sm:p-4 bg-purple-500/10 rounded-full shrink-0">
                <Mic className="text-purple-400 w-6 h-6" />
              </div>

              <div className="text-left">
                <h3 className="font-bold text-base sm:text-lg">
                  Modo Narrador IA
                </h3>

                <p className="text-zinc-500 text-xs sm:text-sm">
                  Guion, voz y subtítulos.
                </p>
              </div>
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            {mode === "voice" && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <label className="font-bold text-base sm:text-lg">
                    Describe el producto
                  </label>

                  <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1">
                    <Globe className="w-4 h-4 text-zinc-400" />

                    <select
                      value={language}
                      onChange={(event) =>
                        setLanguage(
                          event.target.value
                        )
                      }
                      className="bg-transparent text-xs sm:text-sm outline-none"
                    >
                      <option value="es">
                        Español
                      </option>

                      <option value="en">
                        English
                      </option>

                      <option value="pt">
                        Português
                      </option>

                      <option value="fr">
                        Français
                      </option>
                    </select>
                  </div>
                </div>

                <textarea
                  value={productPrompt}
                  onChange={(event) =>
                    setProductPrompt(
                      event.target.value
                    )
                  }
                  placeholder="Ej: Aspiradora portátil para coche..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 sm:p-4 focus:border-purple-500 outline-none h-28 sm:h-32 resize-none text-sm sm:text-base"
                />
              </>
            )}

            <button
              onClick={processVideo}
              disabled={
                mode === "voice" &&
                productPrompt.trim()
                  .length < 3
              }
              className="w-full py-3 sm:py-4 bg-white text-black rounded-xl font-bold text-base sm:text-lg flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 transition-transform"
            >
              <Wand2 className="w-5 h-5" />
              Crear Vídeo
            </button>
          </div>
        )}

        {step === 4 && (
          <div className="py-8 sm:py-12 flex flex-col items-center">
            <div className="relative w-20 h-20 sm:w-24 sm:h-24 mb-6">
              <div className="absolute inset-0 border-4 border-zinc-800 border-t-purple-500 rounded-full animate-spin" />

              <div className="absolute inset-0 flex items-center justify-center font-bold font-mono">
                {progress}%
              </div>
            </div>

            <h2 className="text-lg sm:text-xl font-bold text-center">
              Exportando vídeo...
            </h2>

            <p className="text-zinc-500 text-xs sm:text-sm mt-2 text-center px-4">
              {status}
            </p>
          </div>
        )}

        {step === 5 &&
          finalVideo && (
            <div className="flex flex-col items-center">
              <div className="w-[240px] h-[426px] sm:w-[280px] sm:h-[498px] bg-black rounded-2xl sm:rounded-[2rem] overflow-hidden border-2 sm:border-4 border-zinc-800 shadow-2xl relative mb-6 sm:mb-8">
                <video
                  src={finalVideo}
                  controls
                  autoPlay
                  loop
                  playsInline
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="flex w-full gap-3 sm:gap-4">
                <button
                  onClick={resetAll}
                  className="flex-1 py-3 sm:py-4 bg-zinc-800 rounded-xl font-bold flex items-center justify-center gap-2 active:bg-zinc-700"
                >
                  <RefreshCcw className="w-4 h-4 sm:w-5 sm:h-5" />
                  Otro
                </button>

                <a
                  href={finalVideo}
                  download={`tiktok-viral-${language}.${videoExtension}`}
                  className="flex-1 py-3 sm:py-4 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl font-bold flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4 sm:w-5 sm:h-5" />
                  Guardar
                </a>
              </div>

              <p className="text-xs text-zinc-600 mt-3">
                Formato: {videoMimeType}
              </p>
            </div>
          )}
      </div>
    </main>
  );
}
