"use client";

/**
 * Plays a clip regardless of where it's hosted. Google Drive's
 * uc?export=download links answer with redirects/HTML instead of a video
 * MIME type, so <video> refuses them ("no supported format and MIME type") —
 * Drive files go through Drive's own embed player instead. Direct mp4 links
 * (fal, Railway) keep the native <video> tag.
 */
const driveId = (url: string): string | null => {
  const m =
    url.match(/[?&]id=([\w-]+)/) ?? url.match(/\/file\/d\/([\w-]+)/);
  return m ? m[1] : null;
};

export default function MediaPlayer({
  url,
  portrait = false,
  maxHeight = 420,
}: {
  url: string;
  portrait?: boolean;
  maxHeight?: number;
}) {
  const ratio = portrait ? "9 / 16" : "16 / 9";
  const id = url.includes("drive.google.com") ? driveId(url) : null;

  const frameStyle: React.CSSProperties = {
    aspectRatio: ratio,
    width: portrait ? "auto" : "100%",
    height: portrait ? maxHeight : "auto",
    maxWidth: "100%",
    margin: "0 auto",
    display: "block",
    borderRadius: 12,
    background: "#000",
    border: "none",
  };

  if (id) {
    return (
      <iframe
        src={`https://drive.google.com/file/d/${id}/preview`}
        style={frameStyle}
        allow="autoplay; fullscreen"
        allowFullScreen
      />
    );
  }
  return <video src={url} controls preload="metadata" style={frameStyle} />;
}
