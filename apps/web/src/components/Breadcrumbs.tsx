import { Link } from "@/i18n/navigation";

export interface Crumb {
  name: string;
  href?: string;
}

/** Visible breadcrumbs; the same trail goes into BreadcrumbList structured data on each page. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((item, index) => (
          <li key={`${item.name}-${index}`}>
            {item.href && index < items.length - 1 ? (
              <Link href={item.href}>{item.name}</Link>
            ) : (
              <span aria-current={index === items.length - 1 ? "page" : undefined}>
                {item.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
