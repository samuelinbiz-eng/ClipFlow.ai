from __future__ import annotations

import json
import os
import threading
from typing import Any

import firebase_admin
from fastapi import HTTPException, Request
from firebase_admin import auth, credentials
from firebase_admin.exceptions import FirebaseError
from google.auth.exceptions import DefaultCredentialsError
from google.auth.credentials import AnonymousCredentials

_APP_NAME = "gemclip"
_APP_LOCK = threading.Lock()
_DEFAULT_PROJECT_ID = "clipflow-ai-bba29"
_CHECK_REVOKED = False


class _PublicKeyOnlyCredential(credentials.Base):
    def get_credential(self) -> AnonymousCredentials:
        return AnonymousCredentials()


def _firebase_app() -> firebase_admin.App:
    global _CHECK_REVOKED
    project_id = os.getenv("FIREBASE_PROJECT_ID", "").strip() or _DEFAULT_PROJECT_ID

    try:
        return firebase_admin.get_app(_APP_NAME)
    except ValueError:
        pass

    with _APP_LOCK:
        try:
            return firebase_admin.get_app(_APP_NAME)
        except ValueError:
            service_account_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
            try:
                if service_account_json:
                    credential = credentials.Certificate(json.loads(service_account_json))
                    _CHECK_REVOKED = True
                else:
                    try:
                        application_default = credentials.ApplicationDefault()
                        application_default.get_credential()
                        credential = application_default
                        _CHECK_REVOKED = True
                    except DefaultCredentialsError as exc:
                        if os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip():
                            raise HTTPException(
                                status_code=503,
                                detail="Le fichier GOOGLE_APPLICATION_CREDENTIALS est invalide ou inaccessible.",
                            ) from exc
                        # ID-token signature verification uses Google's public keys; ADC is
                        # only needed for the optional revocation lookup against Firebase.
                        credential = _PublicKeyOnlyCredential()
                        _CHECK_REVOKED = False
            except (ValueError, json.JSONDecodeError) as exc:
                raise HTTPException(
                    status_code=503,
                    detail="FIREBASE_SERVICE_ACCOUNT_JSON ne contient pas un compte de service valide.",
                ) from exc

            return firebase_admin.initialize_app(
                credential,
                options={"projectId": project_id},
                name=_APP_NAME,
            )


def current_user(request: Request) -> dict[str, Any]:
    authorization = request.headers.get("Authorization", "")
    scheme, separator, token = authorization.partition(" ")
    if not separator or scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Connectez-vous pour continuer.")

    app = _firebase_app()
    try:
        claims = auth.verify_id_token(token.strip(), app=app, check_revoked=_CHECK_REVOKED)
    except (
        auth.InvalidIdTokenError,
        auth.ExpiredIdTokenError,
        auth.RevokedIdTokenError,
        auth.UserDisabledError,
        ValueError,
    ) as exc:
        raise HTTPException(status_code=401, detail="Votre session Firebase est invalide. Reconnectez-vous.") from exc
    except FirebaseError as exc:
        raise HTTPException(
            status_code=503,
            detail="Firebase est momentanément indisponible pour vérifier votre session.",
        ) from exc

    uid = claims.get("uid")
    if not isinstance(uid, str) or not uid:
        raise HTTPException(status_code=401, detail="Le jeton Firebase ne contient pas d’identifiant utilisateur.")
    return {"uid": uid, "email": claims.get("email")}
