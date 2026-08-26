import { RenderConfig, SubtitleCue } from "@/types";

const IS_APPLE = typeof navigator !== "undefined" && 
  (/iPhone|iPad|iPod/i.test(navigator.userAgent) || /^((?!chrome|android).)*safari/i.test(navigator.userAgent));

const INVISIBLE_CSS = "position:fixed;left:-9999px;top:0;width:300px;height:300px;opacity:1;pointer-events:none;z-index:9999;";

export async function renderFinalVideo(config: RenderConfig): Promise<string> {
  const { clips, audioBlob, cues, targetDuration, onProgress } = config;
  const width = 720, height = 1280;

  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.style.cssText = INVISIBLE_CSS;
  document.body.appendChild(canvas);
  
  const ctx = canvas.getContext("2d", { alpha: false })!;

  const videoEls: HTMLVideoElement[] = [];
  for (const clip of clips) {
    const v = document.createElement("video");
    v.src = clip.url;
    v.muted = true; // AUDIO ORIGINAL BORRADO
    v.playsInline = true;
    v.crossOrigin = "anonymous";
    v.style.cssText = INVISIBLE_CSS;
    document.body.appendChild(v);
    await new Promise<void>(res => { v.oncanplay = () => res(); setTimeout(res, 3000); });
    videoEls.push(v);
  }

  const AC = window.AudioContext || (window as any).webkitAudioContext;
  let audioCtx = new AC();
  let dest = audioCtx.createMediaStreamDestination();

  // Despertar Web Audio en Safari
  if (audioCtx.state === "suspended") {
    const buf = audioCtx.createBuffer(1, 1, 22050);
    const src = audioCtx.createBufferSource();
    src.buffer = buf; src.connect(audioCtx.destination); src.start(0);
    await audioCtx.resume();
  }

  if (audioBlob) {
    const ab = await audioBlob.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(ab);
    const source = audioCtx.createBufferSource();
    source.buffer = decoded;
    source.connect(dest);
    source.start(0);
  }

  const canvasStream = canvas.captureStream(30);
  const tracks = [...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()];
  const combinedStream = new MediaStream(tracks);
  
  const mime = IS_APPLE ? "video/mp4" : "video/webm";
  const recorder = new MediaRecorder(combinedStream, { mimeType: mime });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  return new Promise<string>((resolve) => {
    let frameId = 0, isFinished = false, currentClip = 0;
    const clipDur = targetDuration / clips.length;
    const start = performance.now();

    recorder.onstop = () => {
      cancelAnimationFrame(frameId);
      tracks.forEach(t => t.stop());
      videoEls.forEach(v => v.remove());
      canvas.remove();
      resolve(URL.createObjectURL(new Blob(chunks, { type: mime })));
    };

    recorder.start(100);
    videoEls[0]?.play().catch(()=>{});

    const draw = () => {
      if (isFinished) return;
      const elapsed = (performance.now() - start) / 1000;
      onProgress(Math.min(100, (elapsed / targetDuration) * 100));

      if (elapsed >= targetDuration) {
        isFinished = true;
        recorder.stop();
        return;
      }

      const activeIdx = Math.min(clips.length - 1, Math.floor(elapsed / clipDur));
      if (activeIdx !== currentClip) {
        videoEls[currentClip]?.pause();
        currentClip = activeIdx;
        videoEls[currentClip].currentTime = 0;
        videoEls[currentClip].play().catch(()=>{});
      }

      const v = videoEls[currentClip];
      ctx.fillStyle = "#09090b"; ctx.fillRect(0, 0, width, height);
      
      if (v && v.readyState >= 2) {
        const scale = Math.max(width / v.videoWidth, height / v.videoHeight);
        const dw = v.videoWidth * scale, dh = v.videoHeight * scale;
        ctx.drawImage(v, (width - dw) / 2, (height - dh) / 2, dw, dh);
      }

      // Dibujar subtítulos
      const cue = cues.find(c => elapsed >= c.start && elapsed <= c.end);
      if (cue) {
        ctx.font = '900 42px "Inter", sans-serif';
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        const txt = cue.text;
        const y = height * 0.75;
        
        ctx.lineWidth = 8; ctx.strokeStyle = "#000";
        ctx.strokeText(txt, width / 2, y);
        ctx.fillStyle = "#FFE600";
        ctx.fillText(txt, width / 2, y);
      }

      frameId = requestAnimationFrame(draw);
    };
    frameId = requestAnimationFrame(draw);
  });
}
