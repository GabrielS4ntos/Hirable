import assert from "node:assert/strict";
import test from "node:test";
import { pickResumeForJob, resumeCandidatesForModel, scoreResumeForJob } from "./resume-matcher.js";

const aiResume = {
  id: "ai", label: "AI Engineer", headline: "AI Software Engineer", is_default: false,
  roles: ["AI Engineer", "Machine Learning Engineer"],
  technologies: ["Python", "LangGraph", "RAG", "PyTorch"]
};
const fullStackResume = {
  id: "fs", label: "Full Stack", headline: "Full Stack Developer", is_default: true,
  roles: ["Full Stack Developer", "Frontend Engineer"],
  technologies: ["TypeScript", "React", "Node.js", "PostgreSQL"]
};
const resumes = [aiResume, fullStackResume];

const job = (title, text = "") => ({ title, compact_text: text, company: "Acme", location: "Remote" });

test("a job scores higher against the résumé that shares its technologies", () => {
  const aiJob = job("AI Engineer", "Build LLM agents with Python, LangGraph and RAG pipelines");
  assert.ok(scoreResumeForJob(aiJob, aiResume) > scoreResumeForJob(aiJob, fullStackResume));

  const webJob = job("Frontend Developer", "React, TypeScript and Node.js product work");
  assert.ok(scoreResumeForJob(webJob, fullStackResume) > scoreResumeForJob(webJob, aiResume));
});

test("the matching résumé is picked with no model call", () => {
  const picked = pickResumeForJob(job("AI Engineer", "LangGraph, RAG and PyTorch"), resumes);
  assert.equal(picked.resume.id, "ai");
  assert.equal(picked.source, "keywords");
  assert.ok(picked.score > 0);
});

test("the evaluator's choice wins when the id is real", () => {
  const picked = pickResumeForJob(job("Frontend Developer", "React and TypeScript"), resumes, { modelResumeId: "ai" });
  assert.equal(picked.resume.id, "ai");
  assert.equal(picked.source, "model");
});

test("an unknown id from the model is ignored, not trusted", () => {
  const picked = pickResumeForJob(job("AI Engineer", "LangGraph and RAG"), resumes, { modelResumeId: "inventado" });
  assert.equal(picked.resume.id, "ai");
  assert.equal(picked.source, "keywords");
});

test("a job with no signal falls back to the default résumé", () => {
  const picked = pickResumeForJob(job("Office Manager", "Administrative duties"), resumes);
  assert.equal(picked.resume.id, "fs");
  assert.equal(picked.source, "default");
  assert.equal(picked.score, 0);
});

test("a tie falls back to the default instead of picking arbitrarily", () => {
  const twins = [
    { id: "a", label: "A", roles: ["Engineer"], technologies: ["Python"], is_default: false },
    { id: "b", label: "B", roles: ["Engineer"], technologies: ["Python"], is_default: true }
  ];
  const picked = pickResumeForJob(job("Engineer", "Python role"), twins);
  assert.equal(picked.resume.id, "b");
  assert.equal(picked.source, "default_tie");
});

test("no résumés means no choice, never a crash", () => {
  const picked = pickResumeForJob(job("AI Engineer"), []);
  assert.equal(picked.resume, null);
  assert.equal(picked.source, "none");
});

test("accents and casing do not change the match", () => {
  const ptResume = { id: "pt", label: "Backend", roles: ["Engenheiro de Software"], technologies: ["Java"], is_default: false };
  const ptJob = job("Engenheiro de Software", "Vaga para trabalhar com JAVA e microserviços");
  assert.ok(scoreResumeForJob(ptJob, ptResume) > 0);
});

test("the payload sent to the model is compact", () => {
  const candidates = resumeCandidatesForModel(resumes);
  assert.equal(candidates.length, 2);
  assert.deepEqual(Object.keys(candidates[0]).sort(), ["headline", "label", "resume_id", "roles", "technologies"]);
  // No résumé text: that is the whole point of indexing once.
  assert.equal(JSON.stringify(candidates).includes("summary"), false);
  assert.ok(JSON.stringify(candidates).length < 600);
});

test("only a bounded number of résumés reaches the prompt", () => {
  const many = Array.from({ length: 20 }, (_, index) => ({ id: `r${index}`, label: `R${index}`, roles: [], technologies: [] }));
  assert.equal(resumeCandidatesForModel(many).length, 8);
});
