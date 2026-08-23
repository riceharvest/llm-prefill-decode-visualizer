from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.best_list_envelope import BestListEnvelope
from ...models.get_api_best_by import GetApiBestBy
from ...models.get_api_best_context_band import GetApiBestContextBand
from ...models.get_api_best_hw_class import GetApiBestHwClass
from ...models.get_api_best_response_429 import GetApiBestResponse429
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    by: GetApiBestBy | Unset = GetApiBestBy.DECODE,
    price: float | Unset = UNSET,
    electricity_rate: float | Unset = UNSET,
    power_watts: float | Unset = UNSET,
    amortization_months: float | Unset = UNSET,
    prompt_tokens: float | Unset = UNSET,
    output_tokens: float | Unset = UNSET,
    model: str | Unset = UNSET,
    max_params_b: float | Unset = UNSET,
    quant: str | Unset = UNSET,
    hw_class: GetApiBestHwClass | Unset = UNSET,
    hardware: str | Unset = UNSET,
    context_band: GetApiBestContextBand | Unset = UNSET,
    fit_check: bool | Unset = UNSET,
    context_length: int | Unset = 32768,
    precision_bytes: float | Unset = 2.0,
    batch_size: int | Unset = 1,
    limit: int | Unset = 10,
    snapshot: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_by: str | Unset = UNSET
    if not isinstance(by, Unset):
        json_by = by.value

    params["by"] = json_by

    params["price"] = price

    params["electricityRate"] = electricity_rate

    params["powerWatts"] = power_watts

    params["amortizationMonths"] = amortization_months

    params["promptTokens"] = prompt_tokens

    params["outputTokens"] = output_tokens

    params["model"] = model

    params["maxParamsB"] = max_params_b

    params["quant"] = quant

    json_hw_class: str | Unset = UNSET
    if not isinstance(hw_class, Unset):
        json_hw_class = hw_class.value

    params["hwClass"] = json_hw_class

    params["hardware"] = hardware

    json_context_band: str | Unset = UNSET
    if not isinstance(context_band, Unset):
        json_context_band = context_band.value

    params["context_band"] = json_context_band

    params["fitCheck"] = fit_check

    params["contextLength"] = context_length

    params["precisionBytes"] = precision_bytes

    params["batchSize"] = batch_size

    params["limit"] = limit

    params["snapshot"] = snapshot

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/best",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> BestListEnvelope | GetApiBestResponse429 | None:
    if response.status_code == 200:
        response_200 = BestListEnvelope.from_dict(response.json())

        return response_200

    if response.status_code == 429:
        response_429 = GetApiBestResponse429.from_dict(response.json())

        return response_429

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[BestListEnvelope | GetApiBestResponse429]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    by: GetApiBestBy | Unset = GetApiBestBy.DECODE,
    price: float | Unset = UNSET,
    electricity_rate: float | Unset = UNSET,
    power_watts: float | Unset = UNSET,
    amortization_months: float | Unset = UNSET,
    prompt_tokens: float | Unset = UNSET,
    output_tokens: float | Unset = UNSET,
    model: str | Unset = UNSET,
    max_params_b: float | Unset = UNSET,
    quant: str | Unset = UNSET,
    hw_class: GetApiBestHwClass | Unset = UNSET,
    hardware: str | Unset = UNSET,
    context_band: GetApiBestContextBand | Unset = UNSET,
    fit_check: bool | Unset = UNSET,
    context_length: int | Unset = 32768,
    precision_bytes: float | Unset = 2.0,
    batch_size: int | Unset = 1,
    limit: int | Unset = 10,
    snapshot: str | Unset = UNSET,
) -> Response[BestListEnvelope | GetApiBestResponse429]:
    """Ranked answers: fastest or cheapest rigs for given constraints

     Example: /api/best?by=decode&maxParamsB=8&quant=q4_k_m → top rigs for ≤8B models at Q4_K_M by median
    decode speed. by=cost ranks by cost-efficiency instead. Medians carry 95% bootstrap CIs
    (medianXxxCi95 / medianXxxLabel). Responses carry a deterministic `id` (hash of the resolved
    filters) replayable via /api/calc/{id}?endpoint=best&<same filters>.

    Args:
        by (GetApiBestBy | Unset):  Default: GetApiBestBy.DECODE.
        price (float | Unset):
        electricity_rate (float | Unset):
        power_watts (float | Unset):
        amortization_months (float | Unset):
        prompt_tokens (float | Unset):
        output_tokens (float | Unset):
        model (str | Unset):
        max_params_b (float | Unset):
        quant (str | Unset):
        hw_class (GetApiBestHwClass | Unset):
        hardware (str | Unset):
        context_band (GetApiBestContextBand | Unset):
        fit_check (bool | Unset):
        context_length (int | Unset):  Default: 32768.
        precision_bytes (float | Unset):  Default: 2.0.
        batch_size (int | Unset):  Default: 1.
        limit (int | Unset):  Default: 10.
        snapshot (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[BestListEnvelope | GetApiBestResponse429]
    """

    kwargs = _get_kwargs(
        by=by,
        price=price,
        electricity_rate=electricity_rate,
        power_watts=power_watts,
        amortization_months=amortization_months,
        prompt_tokens=prompt_tokens,
        output_tokens=output_tokens,
        model=model,
        max_params_b=max_params_b,
        quant=quant,
        hw_class=hw_class,
        hardware=hardware,
        context_band=context_band,
        fit_check=fit_check,
        context_length=context_length,
        precision_bytes=precision_bytes,
        batch_size=batch_size,
        limit=limit,
        snapshot=snapshot,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    by: GetApiBestBy | Unset = GetApiBestBy.DECODE,
    price: float | Unset = UNSET,
    electricity_rate: float | Unset = UNSET,
    power_watts: float | Unset = UNSET,
    amortization_months: float | Unset = UNSET,
    prompt_tokens: float | Unset = UNSET,
    output_tokens: float | Unset = UNSET,
    model: str | Unset = UNSET,
    max_params_b: float | Unset = UNSET,
    quant: str | Unset = UNSET,
    hw_class: GetApiBestHwClass | Unset = UNSET,
    hardware: str | Unset = UNSET,
    context_band: GetApiBestContextBand | Unset = UNSET,
    fit_check: bool | Unset = UNSET,
    context_length: int | Unset = 32768,
    precision_bytes: float | Unset = 2.0,
    batch_size: int | Unset = 1,
    limit: int | Unset = 10,
    snapshot: str | Unset = UNSET,
) -> BestListEnvelope | GetApiBestResponse429 | None:
    """Ranked answers: fastest or cheapest rigs for given constraints

     Example: /api/best?by=decode&maxParamsB=8&quant=q4_k_m → top rigs for ≤8B models at Q4_K_M by median
    decode speed. by=cost ranks by cost-efficiency instead. Medians carry 95% bootstrap CIs
    (medianXxxCi95 / medianXxxLabel). Responses carry a deterministic `id` (hash of the resolved
    filters) replayable via /api/calc/{id}?endpoint=best&<same filters>.

    Args:
        by (GetApiBestBy | Unset):  Default: GetApiBestBy.DECODE.
        price (float | Unset):
        electricity_rate (float | Unset):
        power_watts (float | Unset):
        amortization_months (float | Unset):
        prompt_tokens (float | Unset):
        output_tokens (float | Unset):
        model (str | Unset):
        max_params_b (float | Unset):
        quant (str | Unset):
        hw_class (GetApiBestHwClass | Unset):
        hardware (str | Unset):
        context_band (GetApiBestContextBand | Unset):
        fit_check (bool | Unset):
        context_length (int | Unset):  Default: 32768.
        precision_bytes (float | Unset):  Default: 2.0.
        batch_size (int | Unset):  Default: 1.
        limit (int | Unset):  Default: 10.
        snapshot (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        BestListEnvelope | GetApiBestResponse429
    """

    return sync_detailed(
        client=client,
        by=by,
        price=price,
        electricity_rate=electricity_rate,
        power_watts=power_watts,
        amortization_months=amortization_months,
        prompt_tokens=prompt_tokens,
        output_tokens=output_tokens,
        model=model,
        max_params_b=max_params_b,
        quant=quant,
        hw_class=hw_class,
        hardware=hardware,
        context_band=context_band,
        fit_check=fit_check,
        context_length=context_length,
        precision_bytes=precision_bytes,
        batch_size=batch_size,
        limit=limit,
        snapshot=snapshot,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    by: GetApiBestBy | Unset = GetApiBestBy.DECODE,
    price: float | Unset = UNSET,
    electricity_rate: float | Unset = UNSET,
    power_watts: float | Unset = UNSET,
    amortization_months: float | Unset = UNSET,
    prompt_tokens: float | Unset = UNSET,
    output_tokens: float | Unset = UNSET,
    model: str | Unset = UNSET,
    max_params_b: float | Unset = UNSET,
    quant: str | Unset = UNSET,
    hw_class: GetApiBestHwClass | Unset = UNSET,
    hardware: str | Unset = UNSET,
    context_band: GetApiBestContextBand | Unset = UNSET,
    fit_check: bool | Unset = UNSET,
    context_length: int | Unset = 32768,
    precision_bytes: float | Unset = 2.0,
    batch_size: int | Unset = 1,
    limit: int | Unset = 10,
    snapshot: str | Unset = UNSET,
) -> Response[BestListEnvelope | GetApiBestResponse429]:
    """Ranked answers: fastest or cheapest rigs for given constraints

     Example: /api/best?by=decode&maxParamsB=8&quant=q4_k_m → top rigs for ≤8B models at Q4_K_M by median
    decode speed. by=cost ranks by cost-efficiency instead. Medians carry 95% bootstrap CIs
    (medianXxxCi95 / medianXxxLabel). Responses carry a deterministic `id` (hash of the resolved
    filters) replayable via /api/calc/{id}?endpoint=best&<same filters>.

    Args:
        by (GetApiBestBy | Unset):  Default: GetApiBestBy.DECODE.
        price (float | Unset):
        electricity_rate (float | Unset):
        power_watts (float | Unset):
        amortization_months (float | Unset):
        prompt_tokens (float | Unset):
        output_tokens (float | Unset):
        model (str | Unset):
        max_params_b (float | Unset):
        quant (str | Unset):
        hw_class (GetApiBestHwClass | Unset):
        hardware (str | Unset):
        context_band (GetApiBestContextBand | Unset):
        fit_check (bool | Unset):
        context_length (int | Unset):  Default: 32768.
        precision_bytes (float | Unset):  Default: 2.0.
        batch_size (int | Unset):  Default: 1.
        limit (int | Unset):  Default: 10.
        snapshot (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[BestListEnvelope | GetApiBestResponse429]
    """

    kwargs = _get_kwargs(
        by=by,
        price=price,
        electricity_rate=electricity_rate,
        power_watts=power_watts,
        amortization_months=amortization_months,
        prompt_tokens=prompt_tokens,
        output_tokens=output_tokens,
        model=model,
        max_params_b=max_params_b,
        quant=quant,
        hw_class=hw_class,
        hardware=hardware,
        context_band=context_band,
        fit_check=fit_check,
        context_length=context_length,
        precision_bytes=precision_bytes,
        batch_size=batch_size,
        limit=limit,
        snapshot=snapshot,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    by: GetApiBestBy | Unset = GetApiBestBy.DECODE,
    price: float | Unset = UNSET,
    electricity_rate: float | Unset = UNSET,
    power_watts: float | Unset = UNSET,
    amortization_months: float | Unset = UNSET,
    prompt_tokens: float | Unset = UNSET,
    output_tokens: float | Unset = UNSET,
    model: str | Unset = UNSET,
    max_params_b: float | Unset = UNSET,
    quant: str | Unset = UNSET,
    hw_class: GetApiBestHwClass | Unset = UNSET,
    hardware: str | Unset = UNSET,
    context_band: GetApiBestContextBand | Unset = UNSET,
    fit_check: bool | Unset = UNSET,
    context_length: int | Unset = 32768,
    precision_bytes: float | Unset = 2.0,
    batch_size: int | Unset = 1,
    limit: int | Unset = 10,
    snapshot: str | Unset = UNSET,
) -> BestListEnvelope | GetApiBestResponse429 | None:
    """Ranked answers: fastest or cheapest rigs for given constraints

     Example: /api/best?by=decode&maxParamsB=8&quant=q4_k_m → top rigs for ≤8B models at Q4_K_M by median
    decode speed. by=cost ranks by cost-efficiency instead. Medians carry 95% bootstrap CIs
    (medianXxxCi95 / medianXxxLabel). Responses carry a deterministic `id` (hash of the resolved
    filters) replayable via /api/calc/{id}?endpoint=best&<same filters>.

    Args:
        by (GetApiBestBy | Unset):  Default: GetApiBestBy.DECODE.
        price (float | Unset):
        electricity_rate (float | Unset):
        power_watts (float | Unset):
        amortization_months (float | Unset):
        prompt_tokens (float | Unset):
        output_tokens (float | Unset):
        model (str | Unset):
        max_params_b (float | Unset):
        quant (str | Unset):
        hw_class (GetApiBestHwClass | Unset):
        hardware (str | Unset):
        context_band (GetApiBestContextBand | Unset):
        fit_check (bool | Unset):
        context_length (int | Unset):  Default: 32768.
        precision_bytes (float | Unset):  Default: 2.0.
        batch_size (int | Unset):  Default: 1.
        limit (int | Unset):  Default: 10.
        snapshot (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        BestListEnvelope | GetApiBestResponse429
    """

    return (
        await asyncio_detailed(
            client=client,
            by=by,
            price=price,
            electricity_rate=electricity_rate,
            power_watts=power_watts,
            amortization_months=amortization_months,
            prompt_tokens=prompt_tokens,
            output_tokens=output_tokens,
            model=model,
            max_params_b=max_params_b,
            quant=quant,
            hw_class=hw_class,
            hardware=hardware,
            context_band=context_band,
            fit_check=fit_check,
            context_length=context_length,
            precision_bytes=precision_bytes,
            batch_size=batch_size,
            limit=limit,
            snapshot=snapshot,
        )
    ).parsed
