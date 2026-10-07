import "./identidadChat.css";

/** Los PNG oficiales conservan su transparencia y sus proporciones. */
export function IdentidadChat({ compacta = false }: { compacta?: boolean }) {
  return (
    <div className={`identidad-chat${compacta ? " identidad-chat-compacta" : ""}`}>
      <img
        className="identidad-chat-alzheimer"
        src="/marcas/alzheimer-project.png"
        alt="Alzheimer Project"
        width={978}
        height={629}
        draggable={false}
      />
      <img
        className="identidad-chat-robotix"
        src="/marcas/ai-robotix.png"
        alt="AI Robotix"
        width={2055}
        height={736}
        draggable={false}
      />
    </div>
  );
}
