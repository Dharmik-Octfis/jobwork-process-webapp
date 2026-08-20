import { validateCustomFields } from "./src/modules/settings/customization/custom-fields/customFields.engine.ts";

try {
  const result = validateCustomFields({
    defs: [{ key: "start_time", label: "Start Time", dataType: "time", isRequired: true, config: {} }],
    input: { start_time: "14:30" },
    mode: "create"
  });
  console.log("Success! Output:", result);
} catch (err) {
  console.error("Error:", err);
}
