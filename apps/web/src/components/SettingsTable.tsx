import { getTranslations } from "next-intl/server";
import type { SettingRow } from "@/lib/catalog";

function Value({ row }: { row: SettingRow }) {
  if (row.kind === "color") {
    return (
      <span className="value">
        <span className="swatch" style={{ background: row.defaultText }} aria-hidden="true" />
        {row.defaultText}
      </span>
    );
  }
  return <span className="value">{row.defaultText}</span>;
}

/**
 * A tool's settings as the app shows them, with the value a new store starts with. Built from the
 * tool's own schema, so it can't drift from the app.
 */
export async function SettingsTable({ rows }: { rows: SettingRow[] }) {
  const t = await getTranslations("help");
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">{t("setting")}</th>
            <th scope="col">{t("default")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>
                <strong>{row.label}</strong>
                {row.help && <span className="setting-help">{row.help}</span>}
                {row.options.length > 0 && (
                  <span className="setting-help">
                    {t("options", { options: row.options.join(", ") })}
                  </span>
                )}
                {row.min !== undefined && row.max !== undefined && (
                  <span className="setting-help">{t("range", { min: row.min, max: row.max })}</span>
                )}
              </td>
              <td>
                {row.kind === "group" ? (
                  <ul className="setting-sub">
                    {row.children.map((child) => (
                      <li key={child.key}>
                        {child.label}: <Value row={child} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Value row={row} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
