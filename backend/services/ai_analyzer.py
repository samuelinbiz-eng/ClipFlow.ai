from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from groq import AuthenticationError, Groq

if TYPE_CHECKING:
    from .transcriber import Transcript


@dataclass
class ClipSelection:
    start_time: float
    end_time: float
    titre: str
    explication: str


def analyze_transcript(
    transcript: Transcript, duration: float, target_duration: int = 45
) -> ClipSelection:
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key or api_key.lower() == "your_groq_api_key":
        raise RuntimeError(
            "La variable GROQ_API_KEY est manquante ou invalide. Ajoutez une clé Groq "
            "active dans le fichier .env, puis redémarrez le backend."
        )

    transcript_lines = "\n".join(
        f"[{word.start:.2f}-{word.end:.2f}] {word.text}" for word in transcript.words
    )
    client = Groq(api_key=api_key)
    try:
        response = client.chat.completions.create(
            model=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Tu sélectionnes des passages captivants et autonomes pour des Shorts. "
                        f"Choisis un extrait d'environ {target_duration} secondes. "
                        "Réponds uniquement en JSON valide avec les clés start_time (nombre), "
                        "end_time (nombre), titre (chaîne courte) et explication (une phrase)."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "Choisis le meilleur passage, proche de la durée demandée, entre "
                        "30 et 55 secondes sans dépasser la vidéo.\n"
                        f"Durée cible : {target_duration} secondes.\n"
                        f"Durée de la vidéo : {duration:.2f} secondes.\n"
                        f"Transcription horodatée :\n{transcript_lines}"
                    ),
                },
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
        )
    except AuthenticationError as exc:
        raise RuntimeError(
            "La clé Groq est invalide. Remplacez GROQ_API_KEY dans le fichier .env "
            "par une clé active, puis redémarrez le backend."
        ) from exc

    raw = response.choices[0].message.content
    if not raw:
        raise RuntimeError("Groq a retourné une réponse vide.")
    try:
        data = json.loads(_strip_json_fence(raw))
        selection = ClipSelection(
            start_time=float(data["start_time"]),
            end_time=float(data["end_time"]),
            titre=str(data["titre"]).strip(),
            explication=str(data["explication"]).strip(),
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Réponse JSON invalide de Groq : {raw[:300]}") from exc

    clip_length = selection.end_time - selection.start_time
    if (
        selection.start_time < 0
        or selection.end_time > duration
        or not 30 <= clip_length <= 55
        or not selection.titre
        or not selection.explication
    ):
        raise RuntimeError(
            "Groq a proposé un extrait invalide (durée requise : 30 à 55 secondes)."
        )
    return selection


def _strip_json_fence(value: str) -> str:
    match = re.fullmatch(r"\s*```(?:json)?\s*(.*?)\s*```\s*", value, re.DOTALL)
    return match.group(1) if match else value
