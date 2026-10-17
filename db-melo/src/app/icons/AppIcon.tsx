// Icône d'application dessinée pour ImageResponse (PNG généré au build).
export function AppIcon({ size, maskable = false }: { size: number; maskable?: boolean }) {
  // Les icônes « maskable » doivent garder le motif dans les 80 % centraux.
  const inner = maskable ? size * 0.62 : size * 0.78;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0B0B0F",
        backgroundImage: "radial-gradient(circle at 30% 20%, #3a2a5c 0%, #161622 55%, #0B0B0F 100%)",
        borderRadius: maskable ? 0 : size * 0.22,
      }}
    >
      <div
        style={{
          width: inner,
          height: inner,
          borderRadius: 9999,
          border: `${Math.max(2, size * 0.03)}px solid #E5A93C`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundImage: "repeating-radial-gradient(circle, #111118 0px, #111118 4px, #1c1c28 5px, #111118 7px)",
        }}
      >
        <div
          style={{
            width: inner * 0.42,
            height: inner * 0.42,
            borderRadius: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundImage: "linear-gradient(135deg, #F3C969, #E5A93C 55%, #9A6B1C)",
            color: "#0B0B0F",
            fontSize: inner * 0.16,
            fontWeight: 800,
            letterSpacing: -1,
          }}
        >
          DB
        </div>
      </div>
    </div>
  );
}
