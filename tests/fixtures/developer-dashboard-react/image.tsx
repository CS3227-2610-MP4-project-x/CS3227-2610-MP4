import type { ComponentProps } from "react";
export default function Image({ unoptimized: _unoptimized, ...props }: ComponentProps<"img"> & { unoptimized?: boolean }) {
  void _unoptimized;
  // Synthetic fixture uses no remote image or user identity.
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  return <img {...props} />;
}
