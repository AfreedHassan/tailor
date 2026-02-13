import path from "node:path";

const __dirname = import.meta.dir;
const TEMPLATE_PATH = path.join(__dirname, "prompt-template.txt");

/**
 * Loads the prompt template from disk and fills in placeholders.
 * Edit prompt-template.txt to change the prompt without touching code.
 */
export async function buildPrompt(resumeContent, coverLetterContent, company, title, description, slug) {
  const template = await Bun.file(TEMPLATE_PATH).text();

  return template
    .replaceAll("{{RESUME_CONTENT}}", resumeContent)
    .replaceAll("{{COVER_LETTER_CONTENT}}", coverLetterContent)
    .replaceAll("{{COMPANY}}", company)
    .replaceAll("{{TITLE}}", title)
    .replaceAll("{{DESCRIPTION}}", description)
    .replaceAll("{{SLUG}}", slug);
}
