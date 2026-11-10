import type { ComponentProps } from "react";
export default function Link({ onNavigate: _onNavigate, ...props }: ComponentProps<"a"> & { onNavigate?: () => void }) {
  void _onNavigate;
  return <a {...props} />;
}
