import pino from "pino";

const LEVELS: Record<number, [string, string]> = {
  10: ["TRACE", "color: #9f7aea"],
  20: ["DEBUG", "color: #63b3ed"],
  30: ["INFO", "color: #38a169"],
  40: ["WARN", "color: #d69e2e"],
  50: ["ERROR", "color: #e53e3e"],
  60: ["FATAL", "color: #b83280"],
};

function formatLine(obj: any) {
  const [level, color] = LEVELS[obj.level];
  const msg = obj.msg;
  const rest = { ...obj };
  delete rest.level;
  delete rest.time;
  delete rest.msg;

  const fields = Object.entries(rest)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(" ");

  const text = `%c${level.padEnd(2)} %c${msg}${fields ? `: ${fields}` : ""}`;
  console.log(
    text,
    /// Styles
    color,
    "color: white;",
  );
}

const tracing = pino({
  level: "trace",
});

export default tracing;
