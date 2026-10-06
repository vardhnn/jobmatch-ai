import { writeFileSync } from "fs";
import JSZip from "jszip";

const W = (t: string) => `<w:t xml:space="preserve">${t}</w:t>`;
const P = (t: string) => `<w:p><w:r>${W(t)}</w:r></w:p>`;

const lines = [
  "VISHNU VARDHAN",
  "vishnu.e2e@example.com | +91 98765 43210",
  "linkedin.com/in/vishnu-vardhan | github.com/vishnuvardhan",
  "",
  "SKILLS",
  "Python, FastAPI, PostgreSQL, REST APIs, Git, Docker, React, TypeScript, AWS, Jest",
  "",
  "EXPERIENCE",
  "Software Engineer · Acme Corp · Jun 2023 - Present",
  "Built REST APIs with FastAPI and PostgreSQL serving 2M requests/day.",
  "Junior Developer · Beta Systems · Jul 2021 - May 2023",
  "Maintained Django services, MySQL schemas and CI pipelines.",
  "",
  "EDUCATION",
  "B.Tech Computer Science, JNTU Hyderabad, 2017 - 2021",
  "",
  "PROJECTS",
  "JobBoard Aggregator - Aggregated and normalized job listings. Python, FastAPI",
];

const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${lines.map(P).join("\n")}
</w:body></w:document>`;

const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

async function main() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", ct);
  zip.folder("_rels")!.file(".rels", rels);
  zip.folder("word")!.file("document.xml", docXml);
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  writeFileSync("uploads/e2e-fixture.docx", buf);
  console.log("fixture written:", buf.length, "bytes");
}

main();
