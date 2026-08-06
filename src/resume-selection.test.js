import assert from "node:assert/strict";
import test from "node:test";
import { ensureResumeSelected, readResumeEntries } from "./resume-selection.js";

/**
 * Stand-in for the Easy Apply résumé step.
 *
 * It models the three things the real page does that the flow depends on:
 * cards hidden behind an expand control, a select/unselect radio input whose
 * associated `<label>` carries the filename, and a file input that adds a
 * selected card. LinkedIn's real markup is a `<label>`-wrapped
 * `<input type="radio">`, not a button, so the stand-in exposes the same
 * `evaluate`/`isChecked` shape the real code depends on.
 */
function fakePage({ visible = [], hidden = [], selected = null, hasFileInput = true, uploadThrows = null } = {}) {
  const state = {
    expanded: false,
    selected,
    uploads: [],
    clicks: [],
    get entries() {
      return state.expanded ? [...visible, ...hidden] : [...visible];
    }
  };

  const radio = (labelText, entry, onClick) => ({
    labelText,
    isVisible: async () => true,
    count: async () => 1,
    click: async () => { state.clicks.push(labelText); onClick?.(); },
    isChecked: async () => state.selected === entry,
    evaluate: async (fn) => fn({ labels: [{ innerText: labelText }] }),
    getAttribute: async () => null,
    innerText: async () => labelText
  });

  const button = (name, onClick) => ({
    name,
    isVisible: async () => true,
    count: async () => 1,
    click: async () => { state.clicks.push(name); onClick?.(); },
    getAttribute: async (attribute) => (attribute === "aria-label" ? name : null),
    innerText: async () => name
  });

  const page = {
    state,
    locator: (selector) => {
      if (selector === 'input[type="file"]') {
        return {
          first: () => ({
            count: async () => (hasFileInput ? 1 : 0),
            setInputFiles: async (filePath) => {
              if (uploadThrows) throw new Error(uploadThrows);
              state.uploads.push(filePath);
              // LinkedIn adds the card and selects it.
              visible.push("Curriculo_Backend_2026.pdf");
              state.selected = "Curriculo_Backend_2026.pdf";
            }
          })
        };
      }
      return { innerText: async () => "Currículo\nEscolha um currículo" };
    },
    getByRole: (role, { name }) => {
      const matches = [];
      if (role === "radio") {
        for (const entry of state.entries) {
          const isSelected = state.selected === entry;
          const label = `${isSelected ? "Desmarcar seleção de resume" : "Selecionar resume"} ${entry}`;
          if (name.test?.(label)) {
            matches.push(radio(label, entry, () => { state.selected = entry; }));
          }
        }
      } else if (name.test?.("+2 currículos") || name.test?.("Mostrar mais")) {
        matches.push(button("+2 currículos", () => { state.expanded = true; }));
      }
      return {
        all: async () => matches,
        first: () => matches[0] || { count: async () => 0, click: async () => {} }
      };
    },
    waitForTimeout: async () => {},
    waitForLoadState: async () => {}
  };
  return page;
}

test("a résumé already visible and selected needs no action", async () => {
  const page = fakePage({ visible: ["Curriculo_Backend_2026.pdf"], selected: "Curriculo_Backend_2026.pdf" });
  const result = await ensureResumeSelected(page, { displayName: "Curriculo_Backend_2026.pdf", filePath: "/tmp/cv.pdf" });

  assert.equal(result.confirmed, true);
  assert.equal(result.already_selected, true);
  assert.deepEqual(page.state.uploads, [], "nao pode subir o que ja esta la");
});

test("a résumé visible but unselected is selected and verified", async () => {
  const page = fakePage({ visible: ["CV_antigo_2019.pdf", "Curriculo_Backend_2026.pdf"], selected: "CV_antigo_2019.pdf" });
  const result = await ensureResumeSelected(page, { displayName: "Curriculo_Backend_2026.pdf", filePath: "/tmp/cv.pdf" });

  assert.equal(result.confirmed, true);
  assert.equal(result.selected_now, true);
  assert.equal(page.state.selected, "Curriculo_Backend_2026.pdf");
  assert.deepEqual(page.state.uploads, []);
});

test("a résumé hidden behind the expand control is found instead of uploaded", async () => {
  const page = fakePage({ visible: ["CV_antigo_2019.pdf"], hidden: ["Curriculo_Backend_2026.pdf"] });
  const result = await ensureResumeSelected(page, { displayName: "Curriculo_Backend_2026.pdf", filePath: "/tmp/cv.pdf" });

  assert.equal(page.state.expanded, true, "a lista precisa ser expandida antes de decidir");
  assert.equal(result.confirmed, true);
  assert.deepEqual(page.state.uploads, [], "expandir evita um upload duplicado");
});

test("a résumé LinkedIn does not have is uploaded and then verified", async () => {
  const page = fakePage({ visible: ["CV_antigo_2019.pdf"] });
  const result = await ensureResumeSelected(page, { displayName: "Curriculo_Backend_2026.pdf", filePath: "/tmp/cv.pdf" });

  assert.equal(result.uploaded, true);
  assert.equal(result.confirmed, true);
  assert.deepEqual(page.state.uploads, ["/tmp/cv.pdf"]);
});

test("upload is skipped when the file cannot be used, and the reason is reported", async () => {
  const page = fakePage({ visible: ["CV_antigo_2019.pdf"] });
  const result = await ensureResumeSelected(page, { displayName: "Curriculo_Backend_2026.pdf", filePath: null, uploadEnabled: false });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "resume_not_found_and_upload_unavailable");
  assert.deepEqual(result.available_entries, ["CV_antigo_2019.pdf"], "o audit precisa dizer o que havia la");
  assert.deepEqual(page.state.uploads, []);
});

test("a failed upload never reports success", async () => {
  const page = fakePage({ visible: ["CV_antigo_2019.pdf"], uploadThrows: "file rejected" });
  const result = await ensureResumeSelected(page, { displayName: "Curriculo_Backend_2026.pdf", filePath: "/tmp/cv.pdf" });

  assert.equal(result.ok, false);
  assert.equal(result.confirmed, false);
  assert.match(result.reason, /upload_failed/);
});

test("a missing file input is reported rather than silently ignored", async () => {
  const page = fakePage({ visible: ["CV_antigo_2019.pdf"], hasFileInput: false });
  const result = await ensureResumeSelected(page, { displayName: "Curriculo_Backend_2026.pdf", filePath: "/tmp/cv.pdf" });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "file_input_not_found");
});

test("selecting the wrong résumé is never reported as confirmed", async () => {
  const page = fakePage({ visible: ["Curriculo_Backend_2026.pdf"] });
  // The click lands, but the page keeps a different résumé selected.
  const original = page.getByRole;
  page.getByRole = (role, options) => {
    const result = original(role, options);
    return {
      ...result,
      all: async () => {
        const buttons = await result.all();
        return buttons.map((button) => ({ ...button, click: async () => { page.state.selected = "CV_antigo_2019.pdf"; } }));
      }
    };
  };

  const outcome = await ensureResumeSelected(page, { displayName: "Curriculo_Backend_2026.pdf", filePath: "/tmp/cv.pdf" });
  assert.equal(outcome.confirmed, false, "o envio nao pode seguir achando que anexou o certo");
  assert.equal(outcome.reason, "selection_not_confirmed_after_click");
});

test("the step is skipped when the form is not showing the résumé section yet", async () => {
  const page = fakePage({});
  page.locator = () => ({ innerText: async () => "Informações de contato" });

  const result = await ensureResumeSelected(page, { displayName: "Curriculo_Backend_2026.pdf", filePath: "/tmp/cv.pdf" });
  assert.equal(result.ok, true, "nao e um erro: a etapa de curriculo ainda nao apareceu");
  assert.equal(result.confirmed, false);
  assert.equal(result.reason, "resume_not_visible_yet");
});

test("entries are read from the accessible name of the selection control", async () => {
  const page = fakePage({ visible: ["Curriculo_Backend_2026.pdf"], selected: "Curriculo_Backend_2026.pdf" });
  const entries = await readResumeEntries(page);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].text, "Curriculo_Backend_2026.pdf", "o prefixo do rotulo precisa sair");
  assert.equal(entries[0].selected, true);
});

test("entries are read from Portuguese accessible names with 'currículo' or 'curriculo'", async () => {
  const radio = (labelText, checked) => ({
    isVisible: async () => true,
    count: async () => 1,
    click: async () => {},
    isChecked: async () => checked,
    evaluate: async (fn) => fn({ labels: [{ innerText: labelText }] }),
    getAttribute: async () => null,
    innerText: async () => labelText
  });

  const page = {
    getByRole: (role, { name }) => {
      if (role !== "radio") return { all: async () => [] };
      const entries = [
        { label: "Selecionar currículo Maria Oliveira - Software Engineer.docx", checked: false },
        { label: "Desmarcar seleção de currículo Maria Oliveira - Senior Dev.pdf", checked: true }
      ];
      const matches = entries.filter((e) => name.test?.(e.label)).map((e) => radio(e.label, e.checked));
      return { all: async () => matches };
    }
  };

  const entries = await readResumeEntries(page);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].text, "Maria Oliveira - Software Engineer.docx");
  assert.equal(entries[0].selected, false);
  assert.equal(entries[1].text, "Maria Oliveira - Senior Dev.pdf");
  assert.equal(entries[1].selected, true);
});
