"use client";

import {useState, useRef, useEffect, useCallback} from "react";
import WaveSurfer from "wavesurfer.js";
import {SkipBack, Play, Pause} from "lucide-react";

export default function AudioPlayer() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [tempo, setTempo] = useState(1.0);
  const [isDragging, setIsDragging] = useState(false);
  const [wasPlayingBeforeDrag, setWasPlayingBeforeDrag] = useState(false);
  const [regionStart, setRegionStart] = useState<number | null>(null);
  const [regionEnd, setRegionEnd] = useState<number | null>(null);
  const [shouldLoop, setShouldLoop] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const seekTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dragStartXRef = useRef<number>(0);
  const dragStartProgressRef = useRef<number>(0);
  const dragStartTimeRef = useRef<number>(0);
  const isDraggedRef = useRef<boolean>(false);
  const [lastDragUpdate, setLastDragUpdate] = useState<number>(0);
  const lastMousePosRef = useRef<{x: number; time: number} | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);

  const generateWaveformData = async (file: File) => {
    const audioContext = new AudioContext();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const channelData = audioBuffer.getChannelData(0);
    const samples = 2000; // Increased number of samples for better resolution
    const blockSize = Math.floor(channelData.length / samples);
    const dataPoints: number[] = [];

    // Use a more efficient peak sampling method
    for (let i = 0; i < samples; i++) {
      let min = Infinity;
      let max = -Infinity;

      // Find min and max values in each block
      for (let j = 0; j < blockSize; j++) {
        const datum = channelData[i * blockSize + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }

      // Store both min and max values for better waveform representation
      dataPoints.push(max);
      dataPoints.push(min);
    }

    // Normalize the data
    const maxValue = Math.max(...dataPoints.map(Math.abs));
    const normalizedData = dataPoints.map((point) => point / maxValue);

    setWaveformData(normalizedData);

    // Center the waveform initially
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      setScrollPosition(-rect.width / 2);
    }
  };

  const drawWaveform = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Get display dimensions
    const rect = canvas.getBoundingClientRect();
    const displayWidth = rect.width;
    const displayHeight = rect.height;

    // Set up high DPI canvas
    const dpr = window.devicePixelRatio || 1;
    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, displayWidth, displayHeight);

    // Apply zoom to bar dimensions
    const baseBarWidth = 2;
    const baseBarGap = 1;
    const barWidth = baseBarWidth * zoomLevel;
    const barGap = baseBarGap * zoomLevel;
    const totalBarWidth = barWidth + barGap;

    // Calculate visible range with padding for smooth scrolling
    const barsInView = Math.ceil(displayWidth / totalBarWidth) + 2; // Add padding
    const startIndex = Math.max(
      0,
      Math.floor((scrollPosition - totalBarWidth) / totalBarWidth) * 2
    );
    const endIndex = Math.min(
      startIndex + (barsInView + 2) * 2,
      waveformData.length
    );

    // Create gradient for better visual
    const gradient = ctx.createLinearGradient(0, 0, 0, displayHeight);
    gradient.addColorStop(0, "rgb(200, 0, 200)");
    gradient.addColorStop(1, "rgb(150, 0, 150)");
    ctx.strokeStyle = gradient;
    ctx.lineWidth = barWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Draw waveform using path for better performance
    ctx.beginPath();
    let isFirstPoint = true;
    for (let i = startIndex; i < endIndex; i += 2) {
      const maxPoint = waveformData[i];
      const minPoint = waveformData[i + 1];
      const x = (i / 2) * totalBarWidth - scrollPosition;

      // Draw from max to min point for a connected waveform look
      const maxHeight = maxPoint * displayHeight * 0.8;
      const minHeight = minPoint * displayHeight * 0.8;
      const centerY = displayHeight / 2;

      if (isFirstPoint) {
        ctx.moveTo(x, centerY + maxHeight / 2);
        isFirstPoint = false;
      } else {
        ctx.lineTo(x, centerY + maxHeight / 2);
      }
      ctx.lineTo(x, centerY + minHeight / 2);
    }
    ctx.stroke();

    // Draw region if exists
    if (regionStart !== null && wavesurferRef.current) {
      const duration = wavesurferRef.current.getDuration();
      const totalWidth = (waveformData.length / 2) * totalBarWidth;
      const regionStartX =
        (regionStart / duration) * totalWidth - scrollPosition;

      // Draw region start marker
      ctx.fillStyle = "rgb(128, 90, 213)"; // Purple color matching the buttons
      ctx.fillRect(regionStartX - 1, 0, 2, displayHeight);

      if (regionEnd !== null) {
        const regionEndX = (regionEnd / duration) * totalWidth - scrollPosition;
        // Draw region background
        ctx.fillStyle = "rgba(0, 0, 255, 0.2)";
        ctx.fillRect(regionStartX, 0, regionEndX - regionStartX, displayHeight);

        // Draw region end marker
        ctx.fillStyle = "rgb(128, 90, 213)";
        ctx.fillRect(regionEndX - 1, 0, 2, displayHeight);
      }
    }

    // Draw center cursor with anti-aliasing
    ctx.fillStyle = "black";
    const cursorX = displayWidth / 2;
    ctx.fillRect(cursorX - 1, 0, 2, displayHeight);
  };

  const updatePlayback = () => {
    if (!wavesurferRef.current || !isPlaying || !canvasRef.current) return;

    const currentTime = wavesurferRef.current.getCurrentTime();
    const duration = wavesurferRef.current.getDuration();

    // Handle region boundaries and looping
    if (regionStart !== null && regionEnd !== null) {
      if (currentTime >= regionEnd) {
        if (shouldLoop) {
          wavesurferRef.current.setTime(regionStart);
          wavesurferRef.current.play();
        } else {
          wavesurferRef.current.pause();
          setIsPlaying(false);
        }
      }
    } else {
      if (currentTime >= duration) {
        if (shouldLoop) {
          wavesurferRef.current.setTime(0);
          wavesurferRef.current.play();
        } else {
          wavesurferRef.current.pause();
          setIsPlaying(false);
        }
      }
    }

    const progress = currentTime / duration;

    // Calculate scroll position based on progress with zoom
    const baseBarWidth = 2;
    const baseBarGap = 1;
    const totalBarWidth = (baseBarWidth + baseBarGap) * zoomLevel;
    const totalWidth = (waveformData.length / 2) * totalBarWidth;
    const displayWidth = canvasRef.current.getBoundingClientRect().width;

    // Calculate the position where the current playback point should be
    const currentPoint = totalWidth * progress;
    // Center this point by subtracting half the display width
    const targetScroll = currentPoint - displayWidth / 2;

    // Ensure we don't scroll past the start or end
    const maxScroll = totalWidth - displayWidth / 2;
    const newScroll = Math.max(
      -displayWidth / 2,
      Math.min(targetScroll, maxScroll)
    );
    setScrollPosition(newScroll);

    animationFrameRef.current = requestAnimationFrame(updatePlayback);
  };

  useEffect(() => {
    if (waveformData.length > 0) {
      drawWaveform();
    }
  }, [waveformData, scrollPosition, regionStart, regionEnd, zoomLevel]);

  useEffect(() => {
    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(updatePlayback);
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioFile(file);

    await generateWaveformData(file);

    wavesurferRef.current?.destroy();

    const ws = WaveSurfer.create({
      container: document.createElement("div"),
      height: 0,
    });

    try {
      await ws.loadBlob(file);
      wavesurferRef.current = ws;

      ws.on("play", () => setIsPlaying(true));
      ws.on("pause", () => setIsPlaying(false));
      ws.on("finish", () => {
        setIsPlaying(false);
        // Center the end of the waveform
        if (canvasRef.current) {
          const totalWidth = waveformData.length * 3;
          const canvasWidth = canvasRef.current.width;
          setScrollPosition(totalWidth - canvasWidth / 2);
        }
      });
    } catch (error) {
      console.error("Error loading audio file:", error);
      ws.destroy();
    }
  };

  const handlePlayPause = () => {
    if (!wavesurferRef.current) return;

    // If there's a region, start from region start
    if (!isPlaying && regionStart !== null) {
      wavesurferRef.current.setTime(regionStart);
    }

    wavesurferRef.current.playPause();
  };

  const handleTempoChange = (op: "inc" | "dec" | "reset") => {
    const newTempo =
      op === "reset"
        ? 1.0
        : op === "inc"
        ? Math.min(2.0, Number((tempo + 0.1).toFixed(1)))
        : Math.max(0.5, Number((tempo - 0.1).toFixed(1)));

    setTempo(newTempo);
    wavesurferRef.current?.setPlaybackRate(newTempo);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!wavesurferRef.current || !canvasRef.current) return;

    // Store playing state and pause if playing
    setWasPlayingBeforeDrag(isPlaying);
    if (isPlaying) {
      wavesurferRef.current.pause();
    }

    setIsDragging(true);
    dragStartTimeRef.current = Date.now();
    isDraggedRef.current = false;

    // Store initial click position and progress
    dragStartXRef.current = e.clientX;
    dragStartProgressRef.current =
      wavesurferRef.current.getCurrentTime() /
      wavesurferRef.current.getDuration();
  };

  const handleMouseUp = () => {
    if (seekTimeoutRef.current) {
      clearTimeout(seekTimeoutRef.current);
    }
    setIsDragging(false);

    // Only resume playback if we were dragging and it was playing before
    if (isDraggedRef.current && wasPlayingBeforeDrag && wavesurferRef.current) {
      wavesurferRef.current.play();
    }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!wavesurferRef.current || !canvasRef.current) return;

    // Store playing state and pause if playing
    setWasPlayingBeforeDrag(isPlaying);
    if (isPlaying) {
      wavesurferRef.current.pause();
    }

    setIsDragging(true);
    dragStartTimeRef.current = Date.now();
    isDraggedRef.current = false;

    // Store initial touch position and progress
    dragStartXRef.current = e.touches[0].clientX;
    dragStartProgressRef.current =
      wavesurferRef.current.getCurrentTime() /
      wavesurferRef.current.getDuration();
  };

  const handleTouchEnd = () => {
    if (seekTimeoutRef.current) {
      clearTimeout(seekTimeoutRef.current);
    }
    setIsDragging(false);

    // Only resume playback if we were dragging and it was playing before
    if (isDraggedRef.current && wasPlayingBeforeDrag && wavesurferRef.current) {
      wavesurferRef.current.play();
    }
  };

  // Add smooth seeking function
  const smoothSeek = useCallback(
    (targetTime: number, targetScroll: number) => {
      if (!wavesurferRef.current) return;

      const currentTime = wavesurferRef.current.getCurrentTime();
      const currentScroll = scrollPosition;

      // Adjust smoothing based on zoom level for better performance at low zoom
      const smoothFactor = zoomLevel < 1 ? 0.7 : 0.5;
      const timeStep = (targetTime - currentTime) * smoothFactor;
      const scrollStep = (targetScroll - currentScroll) * smoothFactor;

      // Larger threshold for low zoom levels to reduce unnecessary updates
      const timeThreshold = zoomLevel < 1 ? 0.02 : 0.01;
      const scrollThreshold = zoomLevel < 1 ? 2 : 1;

      if (
        Math.abs(timeStep) < timeThreshold &&
        Math.abs(scrollStep) < scrollThreshold
      ) {
        wavesurferRef.current.setTime(targetTime);
        setScrollPosition(targetScroll);
        animationFrameIdRef.current = null;
        return;
      }

      wavesurferRef.current.setTime(currentTime + timeStep);
      setScrollPosition(currentScroll + scrollStep);

      // Use a more efficient animation loop
      if (
        Math.abs(targetTime - currentTime) > 0.01 ||
        Math.abs(targetScroll - currentScroll) > 1
      ) {
        animationFrameIdRef.current = requestAnimationFrame(() =>
          smoothSeek(targetTime, targetScroll)
        );
      }
    },
    [scrollPosition, zoomLevel]
  );

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDragging || !wavesurferRef.current || !canvasRef.current) return;
      e.preventDefault();

      // Mark as dragged once mouse moves
      isDraggedRef.current = true;

      // Adjust frame rate based on zoom level
      const frameDelay = zoomLevel < 1 ? 24 : 16; // Lower frame rate for low zoom
      const now = performance.now();
      if (now - lastDragUpdate < frameDelay) return;
      setLastDragUpdate(now);

      const rect = canvasRef.current.getBoundingClientRect();
      const baseBarWidth = 2;
      const baseBarGap = 1;
      const totalBarWidth = (baseBarWidth + baseBarGap) * zoomLevel;
      const totalWidth = (waveformData.length / 2) * totalBarWidth;
      const displayWidth = rect.width;

      // Calculate drag direction and distance
      const dragDelta = dragStartXRef.current - e.clientX;

      // Optimize time change calculation for low zoom
      const pixelsPerSecond = totalWidth / wavesurferRef.current.getDuration();
      const sensitivity = zoomLevel < 1 ? 0.8 : 0.6;
      const timeChange = (dragDelta / pixelsPerSecond) * sensitivity;

      // Update time based on drag with optimized bounds checking
      const duration = wavesurferRef.current.getDuration();
      const currentTime = wavesurferRef.current.getCurrentTime();
      const targetTime = Math.max(
        0,
        Math.min(currentTime + timeChange, duration)
      );

      // Optimize scroll calculations
      const progress = targetTime / duration;
      const currentPoint = totalWidth * progress;
      const targetScroll = currentPoint - displayWidth / 2;
      const maxScroll = totalWidth - displayWidth;
      const boundedTargetScroll = Math.max(
        -displayWidth / 2,
        Math.min(targetScroll, maxScroll)
      );

      // Cancel existing animation more efficiently
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }

      // Only start animation if significant change
      const minChange = zoomLevel < 1 ? 0.5 : 0.1;
      if (
        Math.abs(targetTime - currentTime) > minChange ||
        Math.abs(boundedTargetScroll - scrollPosition) > minChange
      ) {
        smoothSeek(targetTime, boundedTargetScroll);
      } else {
        // Direct update for small changes
        wavesurferRef.current.setTime(targetTime);
        setScrollPosition(boundedTargetScroll);
      }

      // Update drag start position
      dragStartXRef.current = e.clientX;
    };

    const handleGlobalTouchMove = (e: TouchEvent) => {
      if (!isDragging || !wavesurferRef.current || !canvasRef.current) return;
      e.preventDefault();

      const touchEvent = {
        clientX: e.touches[0].clientX,
        preventDefault: () => e.preventDefault(),
      };
      handleGlobalMouseMove(touchEvent as unknown as MouseEvent);
    };

    // Cleanup function for animations
    const cleanup = () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
      lastMousePosRef.current = null;
    };

    // Add touch event listeners
    window.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("touchcancel", handleTouchEnd);
    window.addEventListener("touchmove", handleGlobalTouchMove, {
      passive: false,
    });

    // Add mouse event listeners
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("mousemove", handleGlobalMouseMove);

    return () => {
      cleanup();
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
      window.removeEventListener("touchmove", handleGlobalTouchMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("mousemove", handleGlobalMouseMove);
    };
  }, [isDragging, waveformData.length, zoomLevel, lastDragUpdate, smoothSeek]);

  // Clean up animations on unmount
  useEffect(() => {
    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, []);

  const handleSkipBack = () => {
    if (!wavesurferRef.current || !canvasRef.current) return;

    // If there's a region, skip to region start, otherwise skip to beginning
    const targetTime = regionStart !== null ? regionStart : 0;
    wavesurferRef.current.setTime(targetTime);

    // Update scroll position to center the target point
    const baseBarWidth = 2;
    const baseBarGap = 1;
    const totalBarWidth = (baseBarWidth + baseBarGap) * zoomLevel;
    const totalWidth = waveformData.length * totalBarWidth;
    const displayWidth = canvasRef.current.getBoundingClientRect().width;
    const duration = wavesurferRef.current.getDuration();
    const progress = targetTime / duration;
    const currentPoint = totalWidth * progress;
    const targetScroll = currentPoint - displayWidth / 2;
    const maxScroll = totalWidth - displayWidth / 2;

    // Ensure we don't scroll past the start or end
    const newScroll = Math.max(
      -displayWidth / 2,
      Math.min(targetScroll, maxScroll)
    );
    setScrollPosition(newScroll);

    // Start playback
    wavesurferRef.current.play();
  };

  const handleRegionControl = (action: "start" | "end" | "clear") => {
    if (!wavesurferRef.current) return;

    switch (action) {
      case "start":
        // Set region start to current time
        setRegionStart(wavesurferRef.current.getCurrentTime());
        // If end exists and is before start, clear it
        if (
          regionEnd !== null &&
          regionEnd < wavesurferRef.current.getCurrentTime()
        ) {
          setRegionEnd(null);
        }
        drawWaveform();
        break;
      case "end": {
        // Set region end to current time
        const currentTime = wavesurferRef.current.getCurrentTime();
        // Only set end if it's after start
        if (regionStart === null || currentTime > regionStart) {
          setRegionEnd(currentTime);
          // Pause playback after setting end point
          if (isPlaying) {
            wavesurferRef.current.pause();
          }
          drawWaveform();
        }
        break;
      }
      case "clear":
        setRegionStart(null);
        setRegionEnd(null);
        drawWaveform();
        break;
    }
  };

  const handleZoomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canvasRef.current || !wavesurferRef.current) return;

    const newZoom = parseFloat(e.target.value);
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const displayWidth = rect.width;

    // Calculate current center point
    const centerTime = wavesurferRef.current.getCurrentTime();
    const duration = wavesurferRef.current.getDuration();
    const progress = centerTime / duration;

    // Calculate new total width based on zoom
    const baseBarWidth = 2;
    const baseBarGap = 1;
    const totalBarWidth = (baseBarWidth + baseBarGap) * newZoom;
    const totalWidth = waveformData.length * totalBarWidth;

    // Calculate new scroll position to maintain center point
    const currentPoint = totalWidth * progress;
    const newScrollPosition = currentPoint - displayWidth / 2;

    // Update state in a single batch
    setZoomLevel(newZoom);
    setScrollPosition(
      Math.max(
        -displayWidth / 2,
        Math.min(newScrollPosition, totalWidth - displayWidth / 2)
      )
    );
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Aural Prototype</h1>
      <div className="space-y-4">
        <input
          type="file"
          accept="audio/*"
          onChange={handleFileUpload}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleTempoChange("dec")}
            className="w-8 h-8 bg-gray-200 rounded-full hover:bg-gray-300 flex items-center justify-center"
            disabled={!audioFile}
          >
            -
          </button>
          <span className="w-12 text-center font-mono">
            {tempo.toFixed(1)}x
          </span>
          <button
            onClick={() => handleTempoChange("inc")}
            className="w-8 h-8 bg-gray-200 rounded-full hover:bg-gray-300 flex items-center justify-center"
            disabled={!audioFile}
          >
            +
          </button>
          <button
            onClick={() => handleTempoChange("reset")}
            className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300"
            disabled={!audioFile}
          >
            Reset
          </button>
          <button
            onClick={() => handleRegionControl("clear")}
            className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            Clear Region
          </button>
          <label className="flex items-center gap-2 ml-2">
            <input
              type="checkbox"
              checked={shouldLoop}
              onChange={(e) => {
                if (isPlaying && wavesurferRef.current) {
                  wavesurferRef.current.pause();
                }
                setShouldLoop(e.target.checked);
              }}
              className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
            />
            <span className="text-sm text-gray-600">Loop Playback</span>
          </label>
        </div>
        <div className="flex items-center gap-2 w-full">
          <span className="text-sm text-gray-600">Zoom:</span>
          <input
            type="range"
            min="0.5"
            max="5"
            step="0.1"
            value={zoomLevel}
            onChange={handleZoomChange}
            className="w-48 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <span className="text-sm text-gray-600">{zoomLevel.toFixed(1)}x</span>
        </div>
        <div ref={containerRef} className="relative">
          <canvas
            ref={canvasRef}
            className="w-full h-[200px] bg-gray-50 rounded-lg cursor-pointer select-none touch-none"
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
          />
        </div>
        <div className="flex items-center gap-2">
          {audioFile && (
            <div className="flex flex-col justify-center items-center gap-2 w-full">
              <div className="flex w-full justify-center items-center gap-2">
                {/* Playback Buttons */}
                <button
                  onClick={handleSkipBack}
                  className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  <SkipBack />
                </button>
                <button
                  onClick={() => handleRegionControl("start")}
                  className="px-3 py-1 bg-purple-500 text-white rounded hover:bg-purple-600"
                >
                  [
                </button>
                <button
                  onClick={() => handleRegionControl("end")}
                  className="px-3 py-1 bg-purple-500 text-white rounded hover:bg-purple-600"
                >
                  ]
                </button>
                <button
                  onClick={handlePlayPause}
                  className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                >
                  {isPlaying ? <Pause /> : <Play />}
                </button>
              </div>
              <div className="text-sm text-gray-600">
                Use the buttons above to set loop region start and end points.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
