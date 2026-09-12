/**
 * Wraps known acronyms in <abbr title="..."> so a reader can hover one and
 * read what it means.
 *
 *   node scripts/annotate-abbr.mjs private/aab.src.html
 *   node scripts/annotate-abbr.mjs private/aab.src.html --check
 *
 * The private documents are hand-edited, so new prose arrives without tooltips.
 * Run this after an edit and before `npm run publish-private`. It is safe to
 * run repeatedly: text already inside an <abbr> is skipped, so nothing nests.
 *
 * What it does NOT touch:
 *   - attribute values, because it only rewrites text between tags
 *   - the reference URLs in <a class="ru">, where "PMC" and "HTML" are noise
 *   - HTML comments, including the editing note at the top of each document
 *
 * Author initials in a citation (Long AE, Pittman DL) are deliberately absent
 * from the glossary. Product names that are not acronyms (Hamilton STAR, Olink
 * Explore HT, HiPerGator-RV) are absent for the same reason: a tooltip that
 * guesses is worse than no tooltip.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Term to expansion. Order does not matter here; the matcher sorts by length
 * so ROC-AUC wins over AUC and UFDI wins over UF at the same position.
 */
const GLOSSARY = {
  // Institutions and programmes
  UF: 'University of Florida',
  UFDI: 'University of Florida Diabetes Institute',
  UFIT: 'University of Florida Information Technology',
  NIH: 'National Institutes of Health',
  NIDDK: 'National Institute of Diabetes and Digestive and Kidney Diseases',
  ADA: 'American Diabetes Association',
  JDRF: 'Juvenile Diabetes Research Foundation, now Breakthrough T1D',
  FDA: 'United States Food and Drug Administration',
  CMS: 'Centers for Medicare and Medicaid Services',
  HHS: 'United States Department of Health and Human Services',
  CAP: 'College of American Pathologists',
  NIST: 'National Institute of Standards and Technology',
  CLEP: 'Clinical Laboratory Evaluation Program, New York State',
  TrialNet: 'Type 1 Diabetes TrialNet, an international clinical trial network',
  ECHO: 'Extension for Community Healthcare Outcomes',
  STEPS: 'Screening, Treatment, Education, Prevention, Support',
  ASK: 'Autoimmunity Screening for Kids, a Colorado screening programme',
  Fr1da: 'A population screening programme for early-stage type 1 diabetes in Bavaria',

  // Regulation and law
  CLIA: 'Clinical Laboratory Improvement Amendments, the federal law governing clinical laboratory testing',
  HIPAA: 'Health Insurance Portability and Accountability Act',
  LDT: 'Laboratory developed test',
  CFR: 'Code of Federal Regulations',
  FR: 'Federal Register',
  IRB: 'Institutional review board',
  CPT: 'Current Procedural Terminology, the code set used for billing',
  ePHI: 'Electronic protected health information',
  CUI: 'Controlled unclassified information',

  // Florida budget vocabulary
  GAA: 'General Appropriations Act, the annual Florida state budget',
  LFIR: 'Local Funding Initiative Request, the form a legislator files to request a member project',
  SF: 'Senate Form, the number of a Florida Senate appropriations project request',
  HF: 'House Form, the number of a Florida House appropriations project request',
  SB: 'Senate Bill',
  HB: 'House Bill',
  CS: 'Committee Substitute',
  FY: 'Fiscal year',
  ROI: 'Return on investment',

  // Assays and analytes
  ADAP: 'Antibody Detection by Agglutination-PCR',
  PEA: 'Proximity Extension Assay',
  PCR: 'Polymerase chain reaction',
  qPCR: 'Quantitative polymerase chain reaction, read in real time',
  ELISA: 'Enzyme-linked immunosorbent assay',
  ECL: 'Electrochemiluminescence',
  LIPS: 'Luciferase immunoprecipitation system',
  DNA: 'Deoxyribonucleic acid',
  NPX: 'Normalized Protein eXpression, the relative unit Olink reports',
  'ROC-AUC': 'Area under the receiver operating characteristic curve',

  // Clinical
  T1D: 'Type 1 diabetes',
  T2D: 'Type 2 diabetes',
  DKA: 'Diabetic ketoacidosis',
  CGM: 'Continuous glucose monitor',
  HbA1c: 'Glycated haemoglobin, a long-term measure of blood glucose control',
  GADA: 'Glutamic acid decarboxylase autoantibody',
  IAA: 'Insulin autoantibody',
  'IA-2A': 'Insulinoma-associated antigen 2 autoantibody',
  ZnT8A: 'Zinc transporter 8 autoantibody',

  // Computing
  AI: 'Artificial intelligence',
  IT: 'Information technology',
  HPC: 'High performance computing',
  SQL: 'Structured Query Language',
  PMID: 'PubMed identifier',
  PLOS: 'Public Library of Science',
};

/** Longest first, so ROC-AUC beats AUC and qPCR beats PCR at the same index. */
const TERMS = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * \b is wrong at both ends here. It fails before "ePHI" (a lowercase start is
 * not a boundary after a space) and it fires inside "IA-2A". Look-arounds for
 * an adjacent word character give the behaviour we want, with the hyphen
 * allowed on either side only when the term itself has none.
 */
const MATCHER = new RegExp(
  `(?<![\\w-])(${TERMS.map(escape).join('|')})(?![\\w-])`,
  'g',
);

/** Text inside these runs keeps its acronyms bare. */
const SKIP_OPEN = /^<(a class="ru"|abbr|script|style)\b/i;
const SKIP_CLOSE = { a: 'a', abbr: 'abbr', script: 'script', style: 'style' };

function annotate(html) {
  let out = '';
  let skipUntil = null;
  let count = 0;

  // One pass, alternating tag/comment and the text that follows it.
  const parts = html.split(/(<!--[\s\S]*?-->|<[^>]+>)/);
  for (const part of parts) {
    if (!part) continue;

    if (part.startsWith('<')) {
      out += part;
      if (part.startsWith('<!--')) continue;
      if (skipUntil) {
        if (new RegExp(`^</${skipUntil}\\b`, 'i').test(part)) skipUntil = null;
        continue;
      }
      const open = part.match(SKIP_OPEN);
      if (open) skipUntil = SKIP_CLOSE[open[1].split(/[ >]/)[0].toLowerCase()];
      continue;
    }

    if (skipUntil) {
      out += part;
      continue;
    }

    out += part.replace(MATCHER, (m) => {
      count += 1;
      return `<abbr title="${GLOSSARY[m].replace(/"/g, '&quot;')}">${m}</abbr>`;
    });
  }

  return { html: out, count };
}

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/annotate-abbr.mjs <file.html> [--check]');
  process.exit(1);
}

const path = resolve(process.cwd(), file);
const source = await readFile(path, 'utf8');
const { html, count } = annotate(source);

// Terms the glossary defines but the document never uses. Not an error; it
// keeps the glossary honest as documents come and go.
const unused = TERMS.filter((t) => !html.includes(`>${t}</abbr>`));

if (flags.includes('--check')) {
  console.log(`${count} acronym${count === 1 ? '' : 's'} would be wrapped in ${file}`);
  if (unused.length) console.log(`glossary terms not present: ${unused.join(', ')}`);
  process.exit(html === source ? 0 : 1);
}

await writeFile(path, html);
console.log(`wrapped ${count} acronym${count === 1 ? '' : 's'} in ${file}`);
if (unused.length) console.log(`glossary terms not present: ${unused.join(', ')}`);
