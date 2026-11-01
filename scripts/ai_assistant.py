#!/usr/bin/env python3
"""
AI Assistant CLI pour GitHub Actions et automatisation locale.
Propulsé par Google AI Studio (Gemini Flash API).
Optimisé pour l'économie radicale de jetons (Token-First Architecture).
Zéro dépendance externe (uniquement standard library Python 3).
"""

import os
import sys
import re
import json
import argparse
import urllib.request
import urllib.error

# Forcer l'encodage UTF-8 pour stdout et stderr sur tous les systèmes
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

API_URL_TEMPLATE = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
DEFAULT_MODEL = "gemini-2.5-flash-lite"
CANDIDATE_MODELS = [
    "gemini-2.5-flash-lite",
    "gemini-3.8-flash",
    "gemini-flash-latest",
    "gemini-3.6-flash",
]

# Motifs de fichiers exclus de la revue de diff pour épargner le contexte
IGNORED_DIFF_EXTENSIONS = (
    ".lock",
    "-lock.json",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "Cargo.lock",
    ".min.js",
    ".min.css",
    ".map",
    ".svg",
    ".png",
    ".jpg",
    ".jpeg",
    ".ico",
    ".webp",
    ".pdf",
    ".jar",
    ".keystore",
    ".jks",
    ".db",
    ".sqlite",
    ".sqlite3",
)


def filter_git_diff(diff_text: str) -> tuple[str, int]:
    """
    Filtre les sections de diff volumineuses ou parasites (lockfiles, médias, minifiés).
    Retourne le diff épuré et le nombre de fichiers ignorés.
    """
    if not diff_text:
        return "", 0

    chunks = re.split(r"(?=diff --git )", diff_text)
    retained_chunks = []
    ignored_count = 0

    for chunk in chunks:
        if not chunk.strip():
            continue
        first_line = chunk.splitlines()[0]
        # Vérifie si le fichier fait partie des exclusions de tokens
        is_ignored = any(ext in first_line for ext in IGNORED_DIFF_EXTENSIONS)
        if is_ignored:
            ignored_count += 1
            retained_chunks.append(f"{first_line}\n[ℹ️ Diff omis pour préserver les quotas de tokens]\n")
        else:
            retained_chunks.append(chunk)

    filtered = "".join(retained_chunks)
    return filtered, ignored_count


def call_gemini(
    api_key: str,
    prompt: str,
    system_instruction: str = None,
    model: str = DEFAULT_MODEL,
    max_output_tokens: int = 1500,
) -> str:
    """Appelle l'API Gemini REST de manière autonome, résiliente et avec budget de tokens strict."""
    headers = {"Content-Type": "application/json"}

    payload = {
        "contents": [
            {
                "parts": [{"text": prompt}]
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": max_output_tokens,
        },
    }

    if system_instruction:
        payload["systemInstruction"] = {
            "parts": [{"text": system_instruction}]
        }

    models_to_try = [model]
    for m in CANDIDATE_MODELS:
        if m not in models_to_try:
            models_to_try.append(m)

    last_error = None
    for current_model in models_to_try:
        url = API_URL_TEMPLATE.format(model=current_model, key=api_key)
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                res_json = json.loads(resp.read().decode("utf-8"))
                candidates = res_json.get("candidates", [])
                if not candidates:
                    continue
                text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                if text:
                    return text.strip()
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", errors="ignore")
            last_error = f"HTTP {e.code} ({current_model}): {error_body}"
            # Réessayer avec le modèle suivant en cas de surcharge (503), quota (429) ou introuvable (404)
            if e.code in (404, 429, 503):
                continue
            break
        except Exception as e:
            last_error = f"{type(e).__name__} ({current_model}): {str(e)}"
            continue

    return f"⚠️ Échec de l'appel Gemini : {last_error}"


def cmd_review_pr(args, api_key: str):
    """Analyse un diff Git et formule une revue constructive et concise avec budget de tokens maîtrisé."""
    if args.diff_file:
        with open(args.diff_file, "r", encoding="utf-8", errors="ignore") as f:
            diff_text = f.read()
    else:
        diff_text = sys.stdin.read()

    # 1. Épuration du diff (Zero-Waste Filtering)
    filtered_diff, ignored_count = filter_git_diff(diff_text)

    # Si le diff est vide ou ne contenait que des fichiers ignorés
    meaningful_lines = [l for l in filtered_diff.splitlines() if not l.startswith("[ℹ️")]
    if not meaningful_lines or not any(l.startswith("+") or l.startswith("-") for l in meaningful_lines):
        print(
            "### 🤖 Revue Automatique de Code (Gemini Flash)\n\n"
            "✅ **Aucune modification de logique métier à inspecter** "
            f"(changements limités à {ignored_count} fichier(s) technique(s), médias ou lockfiles).\n\n"
            "🛡️ *Économie de tokens : 100 % (Zéro appel API LLM requis).*",
            flush=True,
        )
        return

    # 2. Plafond strict sur la taille du diff d'entrée (12 000 caractères max au lieu de 40 000)
    if len(filtered_diff) > 12000:
        filtered_diff = filtered_diff[:12000] + "\n\n[... Diff tronqué à 12k chars pour économie de tokens ...]"

    system_prompt = (
        "Tu es un Lead Software Engineer expert en CI/CD, sécurité, Android/KMP, Web et Rust/Python. "
        "Formule une revue de PR ultra-concise et percutante (maximum 250 mots). "
        "Structure : "
        "1. 🔒 Sécurité & Dépendances (failles, secrets, paquets parasites) "
        "2. ⚡ Qualité & Performance (bugs potentiels, régressions, complexité) "
        "3. 💡 Recommandation (Approuvé avec / sans réserves)."
    )
    prompt = f"Inspecte ce diff Git épuré :\n\n```diff\n{filtered_diff}\n```"
    result = call_gemini(api_key, prompt, system_prompt, model=args.model, max_output_tokens=1200)
    print(result)


def cmd_solve_issue(args, api_key: str):
    """Génère un plan et le code de solution pour une Issue GitHub avec contexte épuré."""
    title = args.title or "Sans titre"
    body = args.body or "Aucune description fournie."

    context = ""
    if args.context_file and os.path.exists(args.context_file):
        with open(args.context_file, "r", encoding="utf-8", errors="ignore") as f:
            lines = [l.strip() for l in f if l.strip()]
            # Filtrer les chemins parasites dans l'arborescence
            clean_lines = [
                l for l in lines
                if not any(b in l for b in ("node_modules", "build", ".gradle", ".git", "dist", ".idea"))
            ]
            context = "\n".join(clean_lines)[:8000]

    system_prompt = (
        "Tu es un développeur expert autonome. À partir d'une Issue GitHub et du contexte d'un dépôt, "
        "fournis une solution technique précise et compacte : "
        "1. Diagnostic direct du besoin en 2 phrases. "
        "2. Fichiers à modifier/créer avec le code exact nécessaire. "
        "3. Commande de test/validation."
    )
    prompt = f"Issue : {title}\n\nDescription :\n{body}\n"
    if context:
        prompt += f"\nArborescence épurée du dépôt :\n```\n{context}\n```"

    result = call_gemini(api_key, prompt, system_prompt, model=args.model, max_output_tokens=2048)
    print(result)


def cmd_release_notes(args, api_key: str):
    """Génère des Release Notes synthétiques à partir de la liste des commits."""
    if args.commits_file:
        with open(args.commits_file, "r", encoding="utf-8", errors="ignore") as f:
            commits = f.read()
    else:
        commits = sys.stdin.read()

    # Nettoyage des commits inutiles (merges, bumps redondants)
    lines = [
        l.strip() for l in commits.splitlines()
        if l.strip() and not l.lower().startswith("merge ") and not "dependabot" in l.lower()
    ]
    cleaned_commits = "\n".join(lines[:60])  # Max 60 commits

    system_prompt = (
        "Tu es un Release Manager expert. À partir d'une liste de commits Git récents, "
        "génère des Release Notes directes et structurées en Markdown GitHub : "
        "- 🚀 Nouveautés (Features) "
        "- 🐛 Corrections (Bug Fixes) "
        "- ⚡ Performance & Sécurité "
        "Reste concis, évite le bavardage, mets en valeur l'impact utilisateur."
    )
    prompt = f"Version cible : {args.tag}\n\nCommits filtrés :\n```\n{cleaned_commits}\n```"
    result = call_gemini(api_key, prompt, system_prompt, model=args.model, max_output_tokens=1000)
    print(result)


def main():
    parser = argparse.ArgumentParser(description="AI Assistant pour GitHub Actions (Token-Optimized)")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Modèle Gemini à utiliser")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Subcommand review-pr
    p_pr = subparsers.add_parser("review-pr", help="Revue automatique de PR")
    p_pr.add_argument("--diff-file", help="Chemin du fichier diff")

    # Subcommand solve-issue
    p_issue = subparsers.add_parser("solve-issue", help="Résolution autonome d'une issue")
    p_issue.add_argument("--title", required=True, help="Titre de l'issue")
    p_issue.add_argument("--body", required=True, help="Description de l'issue")
    p_issue.add_argument("--context-file", help="Fichier contenant le contexte du dépôt")

    # Subcommand release-notes
    p_rel = subparsers.add_parser("release-notes", help="Génération de Release Notes")
    p_rel.add_argument("--tag", required=True, help="Nom du tag / version")
    p_rel.add_argument("--commits-file", help="Fichier contenant la liste des commits")

    args = parser.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Erreur : La variable d'environnement GEMINI_API_KEY n'est pas définie.", file=sys.stderr)
        sys.exit(1)

    if args.command == "review-pr":
        cmd_review_pr(args, api_key)
    elif args.command == "solve-issue":
        cmd_solve_issue(args, api_key)
    elif args.command == "release-notes":
        cmd_release_notes(args, api_key)


if __name__ == "__main__":
    main()
