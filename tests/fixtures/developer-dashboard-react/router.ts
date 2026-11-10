export const usePathname = () => new URL(window.location.href).pathname;
export const useSelectedLayoutSegment = () => {
  const url = new URL(window.location.href);
  return url.searchParams.get("section") ?? url.pathname.split("/")[3] ?? "dashboard";
};
export const useRouter = () => ({ push: (href: string) => window.location.assign(href), replace: (href: string) => window.location.replace(href), refresh: () => {} });
