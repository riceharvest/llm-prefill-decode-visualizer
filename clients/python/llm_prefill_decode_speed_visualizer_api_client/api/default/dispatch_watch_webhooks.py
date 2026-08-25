from http import HTTPStatus
from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.dispatch_watch_webhooks_response_429 import DispatchWatchWebhooksResponse429
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/watch/dispatch",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | DispatchWatchWebhooksResponse429 | None:
    if response.status_code == 200:
        response_200 = cast(Any, None)
        return response_200

    if response.status_code == 401:
        response_401 = cast(Any, None)
        return response_401

    if response.status_code == 429:
        response_429 = DispatchWatchWebhooksResponse429.from_dict(response.json())

        return response_429

    if response.status_code == 503:
        response_503 = cast(Any, None)
        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | DispatchWatchWebhooksResponse429]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[Any | DispatchWatchWebhooksResponse429]:
    """Deliver unseen matching runs to registered webhooks (#109)

     Cron-friendly (Vercel Cron sends GET). For each watch with a webhookUrl: POST a watch.new_runs
    payload (X-Watch-Secret header) with unseen matching runs (runs dated before the watch are included
    only when the watch was created with includeExisting=true — #699), then persist the seen-set. Set
    WATCH_DISPATCH_SECRET to require ?secret= / x-dispatch-secret. Delivery failures are reported per
    watch, never thrown, and do NOT mark runs seen (#694): the watch backs off exponentially (1min → 24h
    cap) and is retried on later passes; after 5 consecutive failures it is dead-lettered (no more
    attempts) but stays visible in GET /api/watch with its failure state. A successful delivery resets
    the failure state.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | DispatchWatchWebhooksResponse429]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
) -> Any | DispatchWatchWebhooksResponse429 | None:
    """Deliver unseen matching runs to registered webhooks (#109)

     Cron-friendly (Vercel Cron sends GET). For each watch with a webhookUrl: POST a watch.new_runs
    payload (X-Watch-Secret header) with unseen matching runs (runs dated before the watch are included
    only when the watch was created with includeExisting=true — #699), then persist the seen-set. Set
    WATCH_DISPATCH_SECRET to require ?secret= / x-dispatch-secret. Delivery failures are reported per
    watch, never thrown, and do NOT mark runs seen (#694): the watch backs off exponentially (1min → 24h
    cap) and is retried on later passes; after 5 consecutive failures it is dead-lettered (no more
    attempts) but stays visible in GET /api/watch with its failure state. A successful delivery resets
    the failure state.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | DispatchWatchWebhooksResponse429
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[Any | DispatchWatchWebhooksResponse429]:
    """Deliver unseen matching runs to registered webhooks (#109)

     Cron-friendly (Vercel Cron sends GET). For each watch with a webhookUrl: POST a watch.new_runs
    payload (X-Watch-Secret header) with unseen matching runs (runs dated before the watch are included
    only when the watch was created with includeExisting=true — #699), then persist the seen-set. Set
    WATCH_DISPATCH_SECRET to require ?secret= / x-dispatch-secret. Delivery failures are reported per
    watch, never thrown, and do NOT mark runs seen (#694): the watch backs off exponentially (1min → 24h
    cap) and is retried on later passes; after 5 consecutive failures it is dead-lettered (no more
    attempts) but stays visible in GET /api/watch with its failure state. A successful delivery resets
    the failure state.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | DispatchWatchWebhooksResponse429]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
) -> Any | DispatchWatchWebhooksResponse429 | None:
    """Deliver unseen matching runs to registered webhooks (#109)

     Cron-friendly (Vercel Cron sends GET). For each watch with a webhookUrl: POST a watch.new_runs
    payload (X-Watch-Secret header) with unseen matching runs (runs dated before the watch are included
    only when the watch was created with includeExisting=true — #699), then persist the seen-set. Set
    WATCH_DISPATCH_SECRET to require ?secret= / x-dispatch-secret. Delivery failures are reported per
    watch, never thrown, and do NOT mark runs seen (#694): the watch backs off exponentially (1min → 24h
    cap) and is retried on later passes; after 5 consecutive failures it is dead-lettered (no more
    attempts) but stays visible in GET /api/watch with its failure state. A successful delivery resets
    the failure state.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | DispatchWatchWebhooksResponse429
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
