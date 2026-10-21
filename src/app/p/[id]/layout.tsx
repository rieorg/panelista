// No ids at build time: the project page and its results render on first visit,
// then serve from the CDN. Their data loads in the browser.
export const generateStaticParams = async () => [];

export default function ProjectLayout({ children }: LayoutProps<"/p/[id]">) {
  return children;
}
