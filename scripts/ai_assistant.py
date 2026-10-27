#!/usr/bin/env python3
"""
AI Assistant CLI pour GitHub Actions et automatisation locale.
Propulsé par Google AI Studio (Gemini Flash API).
Zéro dépendance externe (uniquement standard library Python 3).
"""

import os
import sys
import json
import argparse
import urllib.request
import urllib.error

# Forcer l'encodage UTF-8 pour stdout et stderr sur tous les systèmes (notamment Windows)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

API_URL_TEMPLATE = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
DEFAULT_MODEL = "gemini-3.6-flash"
CANDIDATE_MODELS = [
    "gemini-3.6-flash",
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite",
    "gemini-3.8-flash",
    "gemini-flash-latest",
]


def call_gemini(api_key: str, prompt: str, system_instruction: str = None, model: str = DEFAULT_MODEL) -> str:
    """Appelle l'API Gemini REST de manière autonome et résiliente."""
    headers = {"Content-Type": "application/json"}
    
    payload = {
        "contents": [
            {
                "parts": [{"text": prompt}]
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 4096,
        }
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
            with urllib.request.urlopen(req, timeout=60) as resp:
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
            
    return f"Échec de l'appel Gemini : {last_error}"


def cmd_review_pr(args, api_key: str):
    """Analyse un diff Git et formule une revue constructive et concise."""
    if args.diff_file:
        with open(args.diff_file, "r", encoding="utf-8", errors="ignore") as f:
            diff_text = f.read()
    else:
        diff_text = sys.stdin.read()

    # Tronquer si le diff est gigantesque pour économiser le contexte
    if len(diff_text) > 40000:
        diff_text = diff_text[:40000] + "\n\n[Diff tronqué pour dépassement de taille...]"

    system_prompt = (
        "Tu es un ingénieur principal et reviewer de code expert en CI/CD, sécurité, Android, iOS, Windows et Web. "
        "Ton rôle est d'analyser le diff d'une Pull Request. Reste concis, constructif et direct. "
        "Souligne : 1) Risques de sécurité et dépendances parasites, 2) Bugs ou incohérences, 3) Suggestions d'optimisation. "
        "Formate en Markdown GitHub avec des sections claires et des listes à puces."
    )
    prompt = f"Voici le diff de la Pull Request à inspecter :\n\n```diff\n{diff_text}\n```"
    result = call_gemini(api_key, prompt, system_prompt, model=args.model)
    print(result)


def cmd_solve_issue(args, api_key: str):
    """Génère un plan et le code de solution pour une Issue GitHub."""
    title = args.title or "Sans titre"
    body = args.body or "Aucune description fournie."
    
    context = ""
    if args.context_file and os.path.exists(args.context_file):
        with open(args.context_file, "r", encoding="utf-8", errors="ignore") as f:
            context = f.read()[:20000]

    system_prompt = (
        "Tu es un développeur expert autonome. À partir d'une Issue GitHub et du contexte d'un dépôt, "
        "ton objectif est de fournir une solution technique exécutable : "
        "1. Une analyse concise du besoin. "
        "2. Les fichiers à créer ou modifier avec leur chemin exact et le code complet sans omission. "
        "3. La stratégie de test et validation."
    )
    prompt = f"Issue : {title}\n\nDescription :\n{body}\n"
    if context:
        prompt += f"\nContexte du projet (arborescence / extraits) :\n```\n{context}\n```"
        
    result = call_gemini(api_key, prompt, system_prompt, model=args.model)
    print(result)


def cmd_release_notes(args, api_key: str):
    """Génère des Release Notes à partir de la liste des commits."""
    if args.commits_file:
        with open(args.commits_file, "r", encoding="utf-8", errors="ignore") as f:
            commits = f.read()
    else:
        commits = sys.stdin.read()

    system_prompt = (
        "Tu es un Release Manager expert. À partir d'une liste de commits Git récents, "
        "génère des Release Notes élégantes et structurées en Markdown GitHub : "
        "- 🚀 Nouveautés (Features) "
        "- 🐛 Corrections (Bug Fixes) "
        "- ⚡ Améliorations & Performance "
        "- 🔒 Sécurité & Dépendances "
        "Sois concis, évite le jargon interne inutile, mets en valeur la valeur apportée aux utilisateurs."
    )
    prompt = f"Version cible : {args.tag}\n\nCommits :\n```\n{commits}\n```"
    result = call_gemini(api_key, prompt, system_prompt, model=args.model)
    print(result)


def main():
    parser = argparse.ArgumentParser(description="AI Assistant pour GitHub Actions")
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
