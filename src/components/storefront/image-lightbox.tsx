"use client";

import { useEffect, useCallback, useState } from "react";
import {
  X,
  ChevronLeft,
  ChevronRight,
  ImageOff,
  ZoomIn,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ImageLightboxProps {
  /** Array of image URLs to display */
  images: string[];
  /** Initial image index to show */
  initialIndex?: number;
  /** Whether the lightbox is open */
  isOpen: boolean;
  /** Called when the lightbox should close */
  onClose: () => void;
}

export function ImageLightbox({
  images,
  initialIndex = 0,
  isOpen,
  onClose,
}: ImageLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [imageLoaded, setImageLoaded] = useState<Record<number, boolean>>({});
  const [imageError, setImageError] = useState<Record<number, boolean>>({});
  const [isZoomed, setIsZoomed] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });

  // Sync currentIndex when initialIndex changes
  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Reset zoom when changing images
  useEffect(() => {
    setIsZoomed(false);
  }, [currentIndex]);

  const goToPrev = useCallback(() => {
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  }, [images.length]);

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) =>
      prev === images.length - 1 ? 0 : prev + 1
    );
  }, [images.length]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowLeft":
          goToPrev();
          break;
        case "ArrowRight":
          goToNext();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, goToPrev, goToNext]);

  // Track mouse position for zoom effect
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isZoomed) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      setMousePos({ x, y });
    },
    [isZoomed]
  );

  if (!isOpen) return null;

  const hasMultipleImages = images.length > 1;
  const hasError = imageError[currentIndex];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="نمایش تصویر"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/90 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Close button */}
      <button
        onClick={onClose}
        aria-label="بستن"
        className="absolute left-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white shadow-lg transition-all hover:bg-black/70 hover:scale-110"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Counter */}
      {hasMultipleImages && (
        <div className="absolute right-4 top-4 z-10 rounded-full bg-black/50 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
          {currentIndex + 1} / {images.length}
        </div>
      )}

      {/* Previous button */}
      {hasMultipleImages && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goToPrev();
          }}
          aria-label="تصویر قبلی"
          className="absolute right-4 top-1/2 z-10 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white shadow-lg transition-all hover:bg-black/70 hover:scale-110"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}

      {/* Next button */}
      {hasMultipleImages && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goToNext();
          }}
          aria-label="تصویر بعدی"
          className="absolute left-4 top-1/2 z-10 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white shadow-lg transition-all hover:bg-black/70 hover:scale-110"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}

      {/* Image container */}
      <div
        className="relative z-10 flex max-h-[90vh] max-w-[90vw] items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Loading skeleton */}
        {!imageLoaded[currentIndex] && !hasError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-16 w-16 animate-spin rounded-full border-4 border-white/20 border-t-white" />
          </div>
        )}

        {/* Error state */}
        {hasError ? (
          <div className="flex flex-col items-center gap-3 text-white/60">
            <ImageOff className="h-20 w-20" />
            <p className="text-sm">بارگذاری تصویر با خطا مواجه شد</p>
            <button
              onClick={() => setImageError((prev) => ({ ...prev, [currentIndex]: false }))}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/20"
            >
              تلاش مجدد
            </button>
          </div>
        ) : (
          <div
            className={cn(
              "relative overflow-hidden rounded-lg transition-all duration-300",
              isZoomed
                ? "cursor-zoom-out"
                : "cursor-zoom-in"
            )}
            onMouseMove={handleMouseMove}
            onClick={() => setIsZoomed(!isZoomed)}
            style={{
              maxHeight: "85vh",
              maxWidth: "85vw",
            }}
          >
            {/* Zoom hint */}
            {!isZoomed && (
              <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-[10px] text-white/70">
                <ZoomIn className="h-3 w-3" />
                بزرگ‌نمایی
              </div>
            )}

            <img
              src={images[currentIndex]}
              alt={`تصویر ${currentIndex + 1}`}
              onLoad={() =>
                setImageLoaded((prev) => ({ ...prev, [currentIndex]: true }))
              }
              onError={() =>
                setImageError((prev) => ({ ...prev, [currentIndex]: true }))
              }
              className={cn(
                "h-auto w-auto select-none transition-opacity duration-300",
                imageLoaded[currentIndex] ? "opacity-100" : "opacity-0",
                isZoomed
                  ? "max-h-none max-w-none scale-[2]"
                  : "max-h-[85vh] max-w-[85vw] object-contain"
              )}
              style={
                isZoomed
                  ? {
                      transformOrigin: `${mousePos.x}% ${mousePos.y}%`,
                    }
                  : undefined
              }
              draggable={false}
            />
          </div>
        )}
      </div>

      {/* Thumbnails strip at bottom */}
      {hasMultipleImages && !hasError && (
        <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 flex gap-2 overflow-x-auto rounded-lg bg-black/50 px-3 py-2">
          {images.map((img, idx) => (
            <button
              key={idx}
              onClick={(e) => {
                e.stopPropagation();
                setCurrentIndex(idx);
                if (imageError[idx]) {
                  setImageError((prev) => ({ ...prev, [idx]: false }));
                }
              }}
              className={cn(
                "h-12 w-12 flex-shrink-0 overflow-hidden rounded-md border-2 transition-all duration-200",
                currentIndex === idx
                  ? "border-white opacity-100 ring-1 ring-white/30"
                  : "border-transparent opacity-50 hover:opacity-80"
              )}
            >
              <img
                src={img}
                alt={`تصویر ${idx + 1}`}
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
