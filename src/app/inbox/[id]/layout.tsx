// The thread, evaluation form and certificate are client pages that load their data
// in the browser. With no ids at build time, each renders once on first visit and
// then serves from the CDN instead of running a function per page view.
export const generateStaticParams = async () => [];

export default function InboxThreadLayout({ children }: LayoutProps<"/inbox/[id]">) {
  return children;
}
