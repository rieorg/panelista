// Client edit form: render once per id on first visit, then serve from the CDN.
export const generateStaticParams = async () => [];

export default function EditProjectLayout({ children }: LayoutProps<"/me/projects/[id]">) {
  return children;
}
