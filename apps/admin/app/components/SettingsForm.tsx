import { useT } from "../lib/i18n";

/** z.toJSONSchema থেকে আসা স্কিমার যতটুকু ফর্মের জন্য দরকার */
export interface JsonSchema {
  type?: string;
  enum?: string[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  properties?: Record<string, JsonSchema>;
}

type Values = Record<string, unknown>;

const HEX = /^\^#\[0-9a-fA-F\]\{6\}\$$/;

/**
 * যেকোনো টুলের সেটিংস ফর্ম স্কিমা দেখে নিজে থেকেই তৈরি হয়।
 * নতুন টুলের জন্য আলাদা ফর্ম লিখতে হয় না।
 */
export function SettingsForm({
  schema,
  values,
  onChange,
}: {
  schema: JsonSchema;
  values: Values;
  onChange: (next: Values) => void;
}) {
  return (
    <s-stack direction="block" gap="base">
      {Object.entries(schema.properties ?? {}).map(([key, field]) => (
        <Field
          key={key}
          name={key}
          schema={field}
          value={values[key]}
          onChange={(v) => onChange({ ...values, [key]: v })}
        />
      ))}
    </s-stack>
  );
}

function Field({
  name,
  schema,
  value,
  onChange,
}: {
  name: string;
  schema: JsonSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const t = useT();
  const label = t(`field.${name}`);

  if (schema.type === "object" && schema.properties) {
    return (
      <s-stack direction="block" gap="small-200">
        <s-heading>{label}</s-heading>
        <SettingsForm schema={schema} values={(value as Values) ?? {}} onChange={onChange} />
      </s-stack>
    );
  }
  if (schema.enum) {
    return (
      <s-select
        label={label}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.currentTarget.value)}
      >
        {schema.enum.map((option) => (
          <s-option key={option} value={option}>
            {t(`option.${option}`)}
          </s-option>
        ))}
      </s-select>
    );
  }
  if (schema.type === "boolean") {
    return (
      <s-checkbox
        label={label}
        checked={value === true}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
    );
  }
  if (schema.type === "string" && schema.pattern && HEX.test(schema.pattern)) {
    return (
      <s-color-field
        label={label}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    );
  }
  if (schema.type === "number" || schema.type === "integer") {
    return (
      <s-number-field
        label={label}
        value={String(value ?? "")}
        {...(schema.minimum !== undefined ? { min: schema.minimum } : {})}
        {...(schema.maximum !== undefined ? { max: schema.maximum } : {})}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
    );
  }
  return (
    <s-text-field
      label={label}
      value={String(value ?? "")}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  );
}
