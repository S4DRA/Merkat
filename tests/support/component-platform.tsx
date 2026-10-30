// Test-only adapters for Next's routing/image primitives; never imported by the app.
import React from "react";
export function useRouter() {
  return {
    push: (href: string) => location.assign(href),
    replace: (href: string) => location.replace(href),
    refresh: () => {},
  };
}
export function usePathname() {
  return location.pathname;
}
export function useSearchParams() {
  return new URLSearchParams(location.search);
}
export function Link({
  href,
  children,
  scroll: ignoredScroll,
  prefetch: ignoredPrefetch,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  scroll?: boolean;
  prefetch?: boolean;
}) {
  void ignoredScroll;
  void ignoredPrefetch;
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}
export function Image({
  src,
  alt = "",
  fill,
  sizes: ignoredSizes,
  priority: ignoredPriority,
  unoptimized: ignoredUnoptimized,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
  fill?: boolean;
  priority?: boolean;
  unoptimized?: boolean;
}) {
  void ignoredSizes;
  void ignoredPriority;
  void ignoredUnoptimized;
  return (
    <img
      src={src}
      alt={alt}
      {...props}
      style={
        fill
          ? {
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              ...props.style,
            }
          : props.style
      }
    />
  );
}
