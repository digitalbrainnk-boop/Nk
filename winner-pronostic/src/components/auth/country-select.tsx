import { Select } from "@/components/ui/field";
import { DEFAULT_PHONE_COUNTRY, PHONE_COUNTRIES } from "@/lib/validation/phone";

/** Sélecteur de pays (avec indicatif téléphonique si `withDialCode`). */
export function CountrySelect({
  name = "country",
  defaultValue = DEFAULT_PHONE_COUNTRY,
  withDialCode = false,
  invalid,
  className,
  ariaLabel,
}: {
  name?: string;
  defaultValue?: string;
  withDialCode?: boolean;
  invalid?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <Select name={name} defaultValue={defaultValue} invalid={invalid} className={className} aria-label={ariaLabel}>
      {PHONE_COUNTRIES.map((c) => (
        <option key={c.code} value={c.code}>
          {withDialCode ? `${c.code} +${c.dialCode}` : c.name}
        </option>
      ))}
    </Select>
  );
}
