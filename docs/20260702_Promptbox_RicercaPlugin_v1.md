---
title: Plugin Obsidian per librerie di prompt AI - ricerca comparativa
date: 2026-07-02
type: nota
status: inbox
tags:
  - t/obsidian
  - t/prompt-engineering
  - p/promptbox
---

# Plugin Obsidian per librerie di prompt AI

Ricerca comparativa del 02/07/2026 su directory ufficiale Obsidian, GitHub e forum.obsidian.md. Obiettivo: verificare l'esistenza di plugin che coprano sia la libreria locale di prompt sia una componente community (pubblicazione, importazione, moderazione).

## Tabella comparativa

| Plugin | Repo GitHub | Descrizione |
|---|---|---|
| Text Generator | [nhaouari/obsidian-textgenerator-plugin](https://github.com/nhaouari/obsidian-textgenerator-plugin) | Generazione testo AI multi-provider. Template di prompt in .md con variabili Handlebars e hub "Community Templates" per importare e pubblicare pacchetti condivisi (registro: [text-gen/text-generator-packages](https://github.com/text-gen/text-generator-packages)). Manutenzione attiva. |
| Copilot for Obsidian | [logancyang/obsidian-copilot](https://github.com/logancyang/obsidian-copilot) | Assistente AI in chat per il vault. Custom prompt come file .md in cartella dedicata, con variabili dinamiche e richiamo rapido via comando "/". Nessuna componente community. |
| AI Prompt Manager | [lefinite/AI-Prompt-Manager-Obsidian-Plugin](https://github.com/lefinite/AI-Prompt-Manager-Obsidian-Plugin) | Libreria prompt in board kanban con versioning, iterazione e copia one-click. Senza variabili, senza community. Apparentemente fermo (v1.0.0, 03/06/2025). |
| Prompt Library | [karthyick/obsidian_plugin_prompt_management](https://github.com/karthyick/obsidian_plugin_prompt_management) | Gestione prompt con tagging automatico (50+ tag, 8 categorie), variabili {{placeholder}} a compilazione interattiva, test inline su Bedrock, Gemini e Groq. Fuori directory ufficiale. |
| PromptCrafter | [fabricehong/obsidian-prompt-crafter-plugin](https://github.com/fabricehong/obsidian-prompt-crafter-plugin) | Prompt modulari in blocchi "pc" con placeholder mustache che risolvono contenuti del vault via frontmatter e wikilink. Condivisione solo via Git di team. |
| Smart Prompts | [brianpetro/obsidian-smart-prompts](https://github.com/brianpetro/obsidian-smart-prompts) | Template di prompt in cartella dedicata con variabili ({{CURRENT}} ecc.), selezione da command palette e invio alla finestra ChatGPT. Repo datato. |
| Vault Prompt AI-Assistant (Magic Wand) | Repo non verificato ([listing directory](https://community.obsidian.md/plugins/vault-prompt-assistant)) | Assistente AI con Prompt Library integrata, batch prompt, workflow su daily note e inserimento risposte nelle note. Nessuna community. |
| Obsidian-Prompt-Library | [cash-bandicoot/Obsidian-Prompt-Library](https://github.com/cash-bandicoot/Obsidian-Prompt-Library) | Componente Datacore/React, non un plugin. Libreria prompt con tag, categorie, ricerca avanzata, preferiti e copia rapida. |

## Verdetto

Copertura parziale dell'ecosistema. Solo Text Generator unisce libreria locale e componente community, ma la parte pubblica è un registro di pacchetti su GitHub (importazione dal plugin, pubblicazione via PR con merge del maintainer). Nessun plugin offre submission in-app, coda di approvazione con stati e ruoli, moderazione post-pubblicazione (segnalazioni, rating) o condivisione a livello di singolo prompt.
