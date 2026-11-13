export default function ShioriMark({ size = 28 }: { size?: number }) {
  return <span aria-hidden="true" className="shiori-mark" style={{ width: size, height: size }} />;
}
