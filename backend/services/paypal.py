from __future__ import annotations

import base64
import json
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

PRICE = "5.99"
CURRENCY = "USD"
PLAN_NAME = "ClipFlow AI Monthly"
PAYPAL_CLIENT_ID = "BAAkTxTBq-s_NfKrpiIxNqhGAsTG7Po0KhQaqKzfsunS4btQhp49Xg0nuxePRSqCtY7pS5Mf_DHVtU06ZQ"
PAYPAL_PLAN_ID = "P-5DV679072B532735YNLGQKHY"

_plan_id: str | None = None
_plan_lock = threading.Lock()


def _api_base() -> str:
    environment = os.getenv("PAYPAL_ENVIRONMENT", "sandbox").strip().lower()
    if environment not in {"sandbox", "live"}:
        raise RuntimeError("PAYPAL_ENVIRONMENT doit être « sandbox » ou « live ».")
    host = "api-m.paypal.com" if environment == "live" else "api-m.sandbox.paypal.com"
    return f"https://{host}"


def _credentials() -> tuple[str, str]:
    client_id = os.getenv("PAYPAL_CLIENT_ID", PAYPAL_CLIENT_ID).strip()
    client_secret = os.getenv("PAYPAL_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise RuntimeError(
            "Configurez PAYPAL_CLIENT_ID et PAYPAL_CLIENT_SECRET dans le fichier .env."
        )
    return client_id, client_secret


def _request(method: str, path: str, data: dict[str, Any] | None = None,
             token: str | None = None) -> dict[str, Any]:
    client_id, client_secret = _credentials()
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    else:
        credentials = base64.b64encode(
            f"{client_id}:{client_secret}".encode("utf-8")
        ).decode("ascii")
        headers["Authorization"] = f"Basic {credentials}"
    if token:
        headers["Authorization"] = "Bearer " + token

    body = None
    if data is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(data).encode("utf-8")
    request = urllib.request.Request(
        f"{_api_base()}{path}",
        data=body,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            response_data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"PayPal a refusé la requête ({exc.code}) : {detail[:500]}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError(f"Impossible de contacter PayPal : {exc}") from exc
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("PayPal a retourné une réponse invalide.") from exc
    if not isinstance(response_data, dict):
        raise RuntimeError("PayPal a retourné une réponse invalide.")
    return response_data


def _access_token() -> str:
    result = _oauth_token()
    access_token = result.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise RuntimeError("PayPal n'a pas retourné de jeton d'accès.")
    return access_token


def _oauth_token() -> dict[str, Any]:
    client_id, client_secret = _credentials()
    credentials = base64.b64encode(
        f"{client_id}:{client_secret}".encode("utf-8")
    ).decode("ascii")
    request = urllib.request.Request(
        f"{_api_base()}/v1/oauth2/token",
        data=urllib.parse.urlencode({"grant_type": "client_credentials"}).encode("ascii"),
        headers={
            "Accept": "application/json",
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"PayPal OAuth a échoué ({exc.code}) : {detail[:500]}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError(f"Impossible de contacter PayPal : {exc}") from exc
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("PayPal a retourné une réponse OAuth invalide.") from exc
    if not isinstance(result, dict):
        raise RuntimeError("PayPal a retourné une réponse OAuth invalide.")
    return result


def _authorized_request(method: str, path: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
    return _request(method, path, data, token=_access_token())


def get_subscription_config() -> dict[str, str]:
    global _plan_id
    client_id = os.getenv("PAYPAL_CLIENT_ID", PAYPAL_CLIENT_ID).strip()
    if not client_id:
        raise RuntimeError("Configurez PAYPAL_CLIENT_ID pour afficher PayPal.")
    configured_plan_id = os.getenv("PAYPAL_PLAN_ID", PAYPAL_PLAN_ID).strip()
    if configured_plan_id:
        plan_id = configured_plan_id
    else:
        with _plan_lock:
            if _plan_id is None:
                _plan_id = _create_monthly_plan()
            plan_id = _plan_id
    return {
        "client_id": client_id,
        "plan_id": plan_id,
        "price": PRICE,
        "currency": CURRENCY,
    }


def _create_monthly_plan() -> str:
    product = _authorized_request(
        "POST",
        "/v1/catalogs/products",
        {
            "name": PLAN_NAME,
            "description": "Abonnement mensuel ClipFlow AI",
            "type": "SERVICE",
            "category": "SOFTWARE",
        },
    )
    product_id = product.get("id")
    if not isinstance(product_id, str) or not product_id:
        raise RuntimeError("PayPal n'a pas retourné l'identifiant du produit.")

    plan = _authorized_request(
        "POST",
        "/v1/billing/plans",
        {
            "product_id": product_id,
            "name": PLAN_NAME,
            "description": "Accès ClipFlow AI facturé chaque mois",
            "status": "ACTIVE",
            "billing_cycles": [
                {
                    "frequency": {"interval_unit": "MONTH", "interval_count": 1},
                    "tenure_type": "REGULAR",
                    "sequence": 1,
                    "total_cycles": 0,
                    "pricing_scheme": {
                        "fixed_price": {"value": PRICE, "currency_code": CURRENCY}
                    },
                }
            ],
            "payment_preferences": {
                "auto_bill_outstanding": True,
                "setup_fee_failure_action": "CONTINUE",
                "payment_failure_threshold": 3,
            },
        },
    )
    plan_id = plan.get("id")
    if not isinstance(plan_id, str) or not plan_id:
        raise RuntimeError("PayPal n'a pas retourné l'identifiant du plan.")
    return plan_id


def verify_subscription(
    subscription_id: str,
    expected_user_id: str | None = None,
) -> dict[str, str]:
    if not subscription_id or len(subscription_id) > 128:
        raise ValueError("Identifiant d'abonnement PayPal invalide.")
    config = get_subscription_config()
    subscription = _authorized_request(
        "GET",
        f"/v1/billing/subscriptions/{urllib.parse.quote(subscription_id, safe='')}",
    )
    if expected_user_id is not None and subscription.get("custom_id") != expected_user_id:
        raise ValueError("Cet abonnement PayPal n’appartient pas à ce compte ClipFlow AI.")
    if subscription.get("plan_id") != config["plan_id"]:
        raise ValueError("Cet abonnement ne correspond pas au plan mensuel ClipFlow AI.")
    status = subscription.get("status")
    if status != "ACTIVE":
        raise ValueError(f"Le paiement n'a pas activé l'abonnement (statut : {status}).")
    billing_info = subscription.get("billing_info") or {}
    last_payment = billing_info.get("last_payment") or {}
    payment_amount = last_payment.get("amount") or {}
    if payment_amount and (
        payment_amount.get("value") != PRICE
        or payment_amount.get("currency_code") != CURRENCY
    ):
        raise ValueError("Le montant de l'abonnement PayPal ne correspond pas à 5,99 USD.")
    return {
        "subscription_id": str(subscription.get("id", subscription_id)),
        "status": status,
    }
