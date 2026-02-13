import slugify from "slugify";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { buildPrompt } from "./prompt-template.js";

const __dirname = import.meta.dir;

const PORT = 3847;
const PROJECT_ROOT = "/Users/mirafreedhassan/projects/resume-cv";

// Persistent job state store
const JOBS_PATH = path.join(__dirname, "jobs.json");

const jobs = new Map();

async function loadJobs() {
  if (await Bun.file(JOBS_PATH).exists()) {
    try {
      const data = JSON.parse(await Bun.file(JOBS_PATH).text());
      for (const job of data) jobs.set(job.jobId, job);
      console.log(`Loaded ${jobs.size} jobs from disk`);
    } catch (e) {
      console.error("Failed to load jobs.json:", e.message);
    }
  }
}

async function saveJobs() {
  await Bun.write(JOBS_PATH, JSON.stringify(Array.from(jobs.values()), null, 2));
}

await loadJobs();

// ---------------------------------------------------------------------------
// CORS helper
// ---------------------------------------------------------------------------
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function corsResponse() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: CORS_HEADERS });
}

// ---------------------------------------------------------------------------
// Bun.serve
// ---------------------------------------------------------------------------
Bun.serve({
  port: PORT,
  async fetch(req) {
    if (req.method === "OPTIONS") return corsResponse();

    const url = new URL(req.url);
    const { pathname } = url;

    // GET / - Dashboard
    if (pathname === "/" && req.method === "GET") {
      return new Response(Bun.file(path.join(__dirname, "dashboard.html")), {
        headers: { ...CORS_HEADERS, "Content-Type": "text/html" },
      });
    }

    // GET /review - Serve the review HTML page
    if (pathname === "/review" && req.method === "GET") {
      return new Response(Bun.file(path.join(__dirname, "review.html")), {
        headers: { ...CORS_HEADERS, "Content-Type": "text/html" },
      });
    }

    // GET /api/jobs - List all jobs (newest first)
    if (pathname === "/api/jobs" && req.method === "GET") {
      const list = Array.from(jobs.values()).reverse().map((j) => ({
        jobId: j.jobId,
        slug: j.slug,
        company: j.company || j.slug,
        title: j.title || "",
        status: j.status,
        message: j.message,
        files: j.files,
        resumeFile: j.resumeFile || null,
        coverLetterFile: j.coverLetterFile || null,
      }));
      return json(list);
    }

    // GET /api/csv - Parse and return applications.csv as JSON
    if (pathname === "/api/csv" && req.method === "GET") {
      try {
        if (!(await Bun.file(CSV_PATH).exists())) return json([]);
        const text = await Bun.file(CSV_PATH).text();
        const lines = text.trim().split("\n");
        if (lines.length <= 1) return json([]);
        const rows = lines.slice(1).map(line => {
          const cols = parseCsvLine(line);
          return {
            company: cols[0] || "",
            status: cols[1] || "",
            role: cols[2] || "",
            salary: cols[3] || "",
            date: cols[4] || "",
            link: cols[5] || "",
            rejection: cols[6] || "",
          };
        });
        return json(rows);
      } catch {
        return json([]);
      }
    }

    // POST /generate
    if (pathname === "/generate" && req.method === "POST") {
      try {
        const { company, title, link, description } = await req.json();

        if (!company || !title || !description) {
          return json({ error: "Missing required fields: company, title, description" }, 400);
        }

        const slug = slugify(company, { lower: true, strict: true });
        const jobId = crypto.randomUUID();
        const jobDir = path.join(PROJECT_ROOT, "jobs", slug);

        await mkdir(jobDir, { recursive: true });

        await Bun.write(path.join(jobDir, "job-description.txt"), [
          `Company: ${company}`,
          `Title: ${title}`,
          "",
          description,
        ].join("\n"));

        let resumeContent, coverLetterContent;
        try {
          resumeContent = await Bun.file(path.join(PROJECT_ROOT, "resume.tex")).text();
        } catch (err) {
          return json({ error: "Failed to read resume.tex: " + err.message }, 500);
        }
        try {
          coverLetterContent = await Bun.file(path.join(PROJECT_ROOT, "cover-letter.tex")).text();
        } catch (err) {
          return json({ error: "Failed to read cover-letter.tex: " + err.message }, 500);
        }

        const prompt = await buildPrompt(resumeContent, coverLetterContent, company, title, description, slug);

        jobs.set(jobId, {
          jobId,
          slug,
          company,
          title,
          link: link || "",
          status: "processing",
          message: "Claude is generating tailored documents...",
          files: [],
        });
        saveJobs();

        // Respond immediately, spawn Claude in background
        spawnClaude(jobId, slug, prompt, jobDir);

        return json({ jobId, slug, status: "processing" });
      } catch (err) {
        console.error("Error in /generate:", err);
        return json({ error: err.message }, 500);
      }
    }

    // GET /status/:jobId
    if (pathname.startsWith("/status/") && req.method === "GET") {
      const jobId = pathname.split("/")[2];
      const job = jobs.get(jobId);
      if (!job) return json({ error: "Job not found" }, 404);
      return json({
        jobId: job.jobId,
        status: job.status,
        message: job.message,
        slug: job.slug,
        files: job.files,
        resumeFile: job.resumeFile || null,
        coverLetterFile: job.coverLetterFile || null,
        emailDraft: job.emailDraft || null,
      });
    }

    // GET /api/review/:jobId
    if (pathname.startsWith("/api/review/") && req.method === "GET") {
      const jobId = pathname.split("/")[3];
      const job = jobs.get(jobId);
      if (!job) return json({ error: "Job not found" }, 404);

      const jobDir = path.join(PROJECT_ROOT, "jobs", job.slug);
      const result = { slug: job.slug, hasPdfs: false };

      try {
        result.resume = await Bun.file(path.join(jobDir, `resume-${job.slug}.tex`)).text();
      } catch { result.resume = ""; }

      try {
        result.coverLetter = await Bun.file(path.join(jobDir, `cover-letter-${job.slug}.tex`)).text();
      } catch { result.coverLetter = ""; }

      try {
        result.email = await Bun.file(path.join(jobDir, "email-draft.md")).text();
      } catch { result.email = ""; }

      result.hasPdfs = await Bun.file(path.join(jobDir, `resume-${job.slug}.pdf`)).exists();

      return json(result);
    }

    // POST /api/compile/:jobId
    if (pathname.startsWith("/api/compile/") && req.method === "POST") {
      const jobId = pathname.split("/")[3];
      const job = jobs.get(jobId);
      if (!job) return json({ error: "Job not found" }, 404);

      const { resume, coverLetter, email, openPdfs } = await req.json();
      const jobDir = path.join(PROJECT_ROOT, "jobs", job.slug);
      const resumeFile = `resume-${job.slug}.tex`;
      const coverFile = `cover-letter-${job.slug}.tex`;
      let log = "";

      try {
        if (resume) await Bun.write(path.join(jobDir, resumeFile), resume);
        if (coverLetter) await Bun.write(path.join(jobDir, coverFile), coverLetter);
        if (email) await Bun.write(path.join(jobDir, "email-draft.md"), email);

        for (const texFile of [resumeFile, coverFile]) {
          const result = await compileTexWithLog(jobDir, texFile);
          log += `--- ${texFile} ---\n${result}\n`;
        }

        if (openPdfs) {
          for (const type of ["resume", "cover-letter"]) {
            const pdfUrl = `http://localhost:${PORT}/files/${job.jobId}/${type}?t=${Date.now()}`;
            Bun.spawn(["open", "-a", "Arc", pdfUrl]);
          }
        }

        updateJob(job.jobId, {
          status: "complete",
          message: "Compiled successfully.",
          resumeFile: `resume-${job.slug}.pdf`,
          coverLetterFile: `cover-letter-${job.slug}.pdf`,
        });

        try { await appendToCsv(job); } catch (e) { console.error("CSV append error:", e); }

        return json({ success: true, log });
      } catch (err) {
        return json({ success: false, error: err.message, log });
      }
    }

    // GET /files/:jobId/:type
    if (pathname.startsWith("/files/") && req.method === "GET") {
      const parts = pathname.split("/");
      const jobId = parts[2];
      const type = parts[3];
      const job = jobs.get(jobId);
      if (!job) return json({ error: "Job not found" }, 404);

      const jobDir = path.join(PROJECT_ROOT, "jobs", job.slug);
      let filename;

      if (type === "resume") {
        filename = `resume-${job.slug}.pdf`;
      } else if (type === "cover-letter") {
        filename = `cover-letter-${job.slug}.pdf`;
      } else if (type === "email") {
        filename = "email-draft.md";
      } else {
        return json({ error: "Invalid file type" }, 400);
      }

      const filePath = path.join(jobDir, filename);
      const file = Bun.file(filePath);

      if (!(await file.exists())) {
        return json({ error: `File not found: ${filename}` }, 404);
      }

      const headers = { ...CORS_HEADERS };
      if (filename.endsWith(".pdf")) {
        headers["Content-Type"] = "application/pdf";
        headers["Content-Disposition"] = `inline; filename="${filename}"`;
      }

      return new Response(file, { headers });
    }

    return json({ error: "Not found" }, 404);
  },
});

console.log(`Resume automation server running on http://localhost:${PORT}`);
console.log(`Project root: ${PROJECT_ROOT}`);

// ---------------------------------------------------------------------------
// Claude CLI spawn + post-processing
// ---------------------------------------------------------------------------
async function spawnClaude(jobId, slug, prompt, jobDir) {
  const env = { ...Bun.env };
  delete env.CLAUDECODE;

  const proc = Bun.spawn(["claude", "--print", "--output-format", "text", "--max-turns", "10", "-p", prompt], {
    cwd: PROJECT_ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Timeout: kill after 5 minutes
  const timeout = setTimeout(() => {
    console.error(`[${jobId}] Claude process timed out after 5 minutes`);
    proc.kill();
    updateJob(jobId, {
      status: "error",
      message: "Claude process timed out after 5 minutes",
    });
  }, 5 * 60 * 1000);

  try {
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    clearTimeout(timeout);

    if (exitCode !== 0) {
      console.error(`[${jobId}] Claude exited with code ${exitCode}: ${stderr}`);
      updateJob(jobId, {
        status: "error",
        message: `Claude exited with code ${exitCode}: ${stderr.slice(0, 500)}`,
      });
      return;
    }

    const files = parseClaudeOutput(stdout);
    if (files.length === 0) {
      updateJob(jobId, {
        status: "error",
        message: "Claude produced no parseable files. Raw output saved to job directory.",
      });
      await Bun.write(path.join(jobDir, "claude-raw-output.txt"), stdout);
      return;
    }

    const writtenFiles = [];
    for (const { filename, content } of files) {
      const filePath = path.join(jobDir, filename);
      await Bun.write(filePath, content);
      writtenFiles.push(filename);
      console.log(`[${jobId}] Wrote ${filePath}`);
    }

    await Bun.write(path.join(jobDir, "claude-raw-output.txt"), stdout);

    let emailDraftContent = "";
    const emailFile = files.find((f) => f.filename === "email-draft.md");
    if (emailFile) {
      emailDraftContent = emailFile.content;
    }

    updateJob(jobId, {
      status: "review",
      message: "Documents generated. Open review page to edit and compile.",
      files: writtenFiles,
      resumeFile: `resume-${slug}.tex`,
      coverLetterFile: `cover-letter-${slug}.tex`,
      emailDraft: emailDraftContent,
    });

    const reviewUrl = `http://localhost:${PORT}/review?id=${jobId}`;
    Bun.spawn(["open", "-a", "Arc", reviewUrl]);
    console.log(`[${jobId}] Ready for review: ${reviewUrl}`);
  } catch (err) {
    clearTimeout(timeout);
    console.error(`[${jobId}] Error in Claude spawn:`, err);
    updateJob(jobId, {
      status: "error",
      message: "Failed to spawn Claude CLI: " + err.message,
    });
  }
}

// ---------------------------------------------------------------------------
// Parse ===FILE: ...=== / ===END FILE=== delimiters
// ---------------------------------------------------------------------------
function parseClaudeOutput(output) {
  const files = [];
  const regex = /===FILE:\s*(.+?)===\s*\n([\s\S]*?)===END FILE===/g;
  let match;
  while ((match = regex.exec(output)) !== null) {
    const filename = match[1].trim();
    const content = match[2].trim() + "\n";
    files.push({ filename, content });
  }
  return files;
}

// ---------------------------------------------------------------------------
// Compile a .tex file using latexmk (returns log output)
// ---------------------------------------------------------------------------
async function compileTexWithLog(jobDir, texFile) {
  try {
    const proc = Bun.spawn(["latexmk", "-pdf", "-interaction=nonstopmode", "-auxdir=../../aux", texFile], {
      cwd: jobDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    const output = stdout + stderr;

    if (exitCode !== 0) {
      console.error(`latexmk failed for ${texFile} (code ${exitCode})`);
      return `[exit ${exitCode}]\n${output}`;
    }
    console.log(`Compiled ${texFile} successfully`);
    return `[OK]\n${output}`;
  } catch (err) {
    return `[spawn error] ${err.message}`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function updateJob(jobId, updates) {
  const job = jobs.get(jobId);
  if (job) {
    Object.assign(job, updates);
    saveJobs();
  }
}

const CSV_PATH = path.join(PROJECT_ROOT, "applications.csv");
const CSV_HEADER = "Company Name,Application Status,Role,Salary,Date Submitted,Link to Job Req,Rejection Reason";

function parseCsvLine(line) {
  const cols = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { cols.push(cur); cur = ""; }
      else { cur += ch; }
    }
  }
  cols.push(cur);
  return cols;
}

function csvEscape(val) {
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

async function appendToCsv(job) {
  if (!(await Bun.file(CSV_PATH).exists())) {
    await Bun.write(CSV_PATH, CSV_HEADER + "\n");
  }

  const date = new Date().toISOString().slice(0, 10);
  const row = [
    csvEscape(job.company || job.slug),
    "Applied",
    csvEscape(job.title || ""),
    "0",
    date,
    csvEscape(job.link || ""),
    "",
  ].join(",");

  const content = await Bun.file(CSV_PATH).text();
  await Bun.write(CSV_PATH, content + row + "\n");
  console.log(`[${job.jobId}] Appended to applications.csv`);
}
