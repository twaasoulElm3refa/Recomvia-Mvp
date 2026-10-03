import type { ComponentProps } from "react";

export function NavigationLink({ href, ...props }: ComponentProps<"a"> & { href: string }) {
  return <a href={href} {...props} />;
}
