from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.compute_inference_architecture import ComputeInferenceArchitecture
from ...models.compute_inference_model import ComputeInferenceModel
from ...models.compute_response import ComputeResponse
from ...models.problem import Problem
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    model: ComputeInferenceModel | Unset = UNSET,
    prompt_tokens: float | Unset = UNSET,
    output_tokens: float | Unset = UNSET,
    prefill_speed: float | Unset = UNSET,
    decode_speed: float | Unset = UNSET,
    num_turns: int | Unset = UNSET,
    enable_prefix_caching: bool | Unset = UNSET,
    batch_size: int | Unset = UNSET,
    draft_tokens: int | Unset = UNSET,
    acceptance_rate: float | Unset = UNSET,
    hardware_price_usd: float | Unset = UNSET,
    electricity_rate_per_kwh: float | Unset = UNSET,
    power_draw_watts: float | Unset = UNSET,
    amortization_months: float | Unset = UNSET,
    architecture: ComputeInferenceArchitecture | Unset = UNSET,
    context_length: int | Unset = UNSET,
    precision_bytes: float | Unset = UNSET,
    flags: str | Unset = UNSET,
    dry_run: bool | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_model: str | Unset = UNSET
    if not isinstance(model, Unset):
        json_model = model.value

    params["model"] = json_model

    params["promptTokens"] = prompt_tokens

    params["outputTokens"] = output_tokens

    params["prefillSpeed"] = prefill_speed

    params["decodeSpeed"] = decode_speed

    params["numTurns"] = num_turns

    params["enablePrefixCaching"] = enable_prefix_caching

    params["batchSize"] = batch_size

    params["draftTokens"] = draft_tokens

    params["acceptanceRate"] = acceptance_rate

    params["hardwarePriceUsd"] = hardware_price_usd

    params["electricityRatePerKwh"] = electricity_rate_per_kwh

    params["powerDrawWatts"] = power_draw_watts

    params["amortizationMonths"] = amortization_months

    json_architecture: str | Unset = UNSET
    if not isinstance(architecture, Unset):
        json_architecture = architecture.value

    params["architecture"] = json_architecture

    params["contextLength"] = context_length

    params["precisionBytes"] = precision_bytes

    params["flags"] = flags

    params["dry_run"] = dry_run

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/compute",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ComputeResponse | Problem | None:
    if response.status_code == 200:
        response_200 = ComputeResponse.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = Problem.from_dict(response.json())

        return response_400

    if response.status_code == 500:
        response_500 = Problem.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ComputeResponse | Problem]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    model: ComputeInferenceModel | Unset = UNSET,
    prompt_tokens: float | Unset = UNSET,
    output_tokens: float | Unset = UNSET,
    prefill_speed: float | Unset = UNSET,
    decode_speed: float | Unset = UNSET,
    num_turns: int | Unset = UNSET,
    enable_prefix_caching: bool | Unset = UNSET,
    batch_size: int | Unset = UNSET,
    draft_tokens: int | Unset = UNSET,
    acceptance_rate: float | Unset = UNSET,
    hardware_price_usd: float | Unset = UNSET,
    electricity_rate_per_kwh: float | Unset = UNSET,
    power_draw_watts: float | Unset = UNSET,
    amortization_months: float | Unset = UNSET,
    architecture: ComputeInferenceArchitecture | Unset = UNSET,
    context_length: int | Unset = UNSET,
    precision_bytes: float | Unset = UNSET,
    flags: str | Unset = UNSET,
    dry_run: bool | Unset = UNSET,
) -> Response[ComputeResponse | Problem]:
    r"""Run inference math (TTFT, TPOT, walltime, VRAM)

     Pass ?model=<name> plus parameters. Omit model for a self-describing capability list. Also accepts
    POST with a JSON body, or a batch of up to 50 parameter sets via POST {\"batch\": [...]} / GET
    ?batch=[...] — returns per-index results with per-item ok/error status. Every computation response
    carries a deterministic `id` (calc_<hash> of the resolved inputs) that can be replayed via
    /api/calc/{id}.

    Args:
        model (ComputeInferenceModel | Unset):
        prompt_tokens (float | Unset):
        output_tokens (float | Unset):
        prefill_speed (float | Unset):
        decode_speed (float | Unset):
        num_turns (int | Unset):
        enable_prefix_caching (bool | Unset):
        batch_size (int | Unset):
        draft_tokens (int | Unset):
        acceptance_rate (float | Unset):
        hardware_price_usd (float | Unset):
        electricity_rate_per_kwh (float | Unset):
        power_draw_watts (float | Unset):
        amortization_months (float | Unset):
        architecture (ComputeInferenceArchitecture | Unset):
        context_length (int | Unset):
        precision_bytes (float | Unset): kvCache precision in bytes/value: 2=FP16, 1=FP8, 0.5=INT4
        flags (str | Unset):
        dry_run (bool | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ComputeResponse | Problem]
    """

    kwargs = _get_kwargs(
        model=model,
        prompt_tokens=prompt_tokens,
        output_tokens=output_tokens,
        prefill_speed=prefill_speed,
        decode_speed=decode_speed,
        num_turns=num_turns,
        enable_prefix_caching=enable_prefix_caching,
        batch_size=batch_size,
        draft_tokens=draft_tokens,
        acceptance_rate=acceptance_rate,
        hardware_price_usd=hardware_price_usd,
        electricity_rate_per_kwh=electricity_rate_per_kwh,
        power_draw_watts=power_draw_watts,
        amortization_months=amortization_months,
        architecture=architecture,
        context_length=context_length,
        precision_bytes=precision_bytes,
        flags=flags,
        dry_run=dry_run,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    model: ComputeInferenceModel | Unset = UNSET,
    prompt_tokens: float | Unset = UNSET,
    output_tokens: float | Unset = UNSET,
    prefill_speed: float | Unset = UNSET,
    decode_speed: float | Unset = UNSET,
    num_turns: int | Unset = UNSET,
    enable_prefix_caching: bool | Unset = UNSET,
    batch_size: int | Unset = UNSET,
    draft_tokens: int | Unset = UNSET,
    acceptance_rate: float | Unset = UNSET,
    hardware_price_usd: float | Unset = UNSET,
    electricity_rate_per_kwh: float | Unset = UNSET,
    power_draw_watts: float | Unset = UNSET,
    amortization_months: float | Unset = UNSET,
    architecture: ComputeInferenceArchitecture | Unset = UNSET,
    context_length: int | Unset = UNSET,
    precision_bytes: float | Unset = UNSET,
    flags: str | Unset = UNSET,
    dry_run: bool | Unset = UNSET,
) -> ComputeResponse | Problem | None:
    r"""Run inference math (TTFT, TPOT, walltime, VRAM)

     Pass ?model=<name> plus parameters. Omit model for a self-describing capability list. Also accepts
    POST with a JSON body, or a batch of up to 50 parameter sets via POST {\"batch\": [...]} / GET
    ?batch=[...] — returns per-index results with per-item ok/error status. Every computation response
    carries a deterministic `id` (calc_<hash> of the resolved inputs) that can be replayed via
    /api/calc/{id}.

    Args:
        model (ComputeInferenceModel | Unset):
        prompt_tokens (float | Unset):
        output_tokens (float | Unset):
        prefill_speed (float | Unset):
        decode_speed (float | Unset):
        num_turns (int | Unset):
        enable_prefix_caching (bool | Unset):
        batch_size (int | Unset):
        draft_tokens (int | Unset):
        acceptance_rate (float | Unset):
        hardware_price_usd (float | Unset):
        electricity_rate_per_kwh (float | Unset):
        power_draw_watts (float | Unset):
        amortization_months (float | Unset):
        architecture (ComputeInferenceArchitecture | Unset):
        context_length (int | Unset):
        precision_bytes (float | Unset): kvCache precision in bytes/value: 2=FP16, 1=FP8, 0.5=INT4
        flags (str | Unset):
        dry_run (bool | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ComputeResponse | Problem
    """

    return sync_detailed(
        client=client,
        model=model,
        prompt_tokens=prompt_tokens,
        output_tokens=output_tokens,
        prefill_speed=prefill_speed,
        decode_speed=decode_speed,
        num_turns=num_turns,
        enable_prefix_caching=enable_prefix_caching,
        batch_size=batch_size,
        draft_tokens=draft_tokens,
        acceptance_rate=acceptance_rate,
        hardware_price_usd=hardware_price_usd,
        electricity_rate_per_kwh=electricity_rate_per_kwh,
        power_draw_watts=power_draw_watts,
        amortization_months=amortization_months,
        architecture=architecture,
        context_length=context_length,
        precision_bytes=precision_bytes,
        flags=flags,
        dry_run=dry_run,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    model: ComputeInferenceModel | Unset = UNSET,
    prompt_tokens: float | Unset = UNSET,
    output_tokens: float | Unset = UNSET,
    prefill_speed: float | Unset = UNSET,
    decode_speed: float | Unset = UNSET,
    num_turns: int | Unset = UNSET,
    enable_prefix_caching: bool | Unset = UNSET,
    batch_size: int | Unset = UNSET,
    draft_tokens: int | Unset = UNSET,
    acceptance_rate: float | Unset = UNSET,
    hardware_price_usd: float | Unset = UNSET,
    electricity_rate_per_kwh: float | Unset = UNSET,
    power_draw_watts: float | Unset = UNSET,
    amortization_months: float | Unset = UNSET,
    architecture: ComputeInferenceArchitecture | Unset = UNSET,
    context_length: int | Unset = UNSET,
    precision_bytes: float | Unset = UNSET,
    flags: str | Unset = UNSET,
    dry_run: bool | Unset = UNSET,
) -> Response[ComputeResponse | Problem]:
    r"""Run inference math (TTFT, TPOT, walltime, VRAM)

     Pass ?model=<name> plus parameters. Omit model for a self-describing capability list. Also accepts
    POST with a JSON body, or a batch of up to 50 parameter sets via POST {\"batch\": [...]} / GET
    ?batch=[...] — returns per-index results with per-item ok/error status. Every computation response
    carries a deterministic `id` (calc_<hash> of the resolved inputs) that can be replayed via
    /api/calc/{id}.

    Args:
        model (ComputeInferenceModel | Unset):
        prompt_tokens (float | Unset):
        output_tokens (float | Unset):
        prefill_speed (float | Unset):
        decode_speed (float | Unset):
        num_turns (int | Unset):
        enable_prefix_caching (bool | Unset):
        batch_size (int | Unset):
        draft_tokens (int | Unset):
        acceptance_rate (float | Unset):
        hardware_price_usd (float | Unset):
        electricity_rate_per_kwh (float | Unset):
        power_draw_watts (float | Unset):
        amortization_months (float | Unset):
        architecture (ComputeInferenceArchitecture | Unset):
        context_length (int | Unset):
        precision_bytes (float | Unset): kvCache precision in bytes/value: 2=FP16, 1=FP8, 0.5=INT4
        flags (str | Unset):
        dry_run (bool | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ComputeResponse | Problem]
    """

    kwargs = _get_kwargs(
        model=model,
        prompt_tokens=prompt_tokens,
        output_tokens=output_tokens,
        prefill_speed=prefill_speed,
        decode_speed=decode_speed,
        num_turns=num_turns,
        enable_prefix_caching=enable_prefix_caching,
        batch_size=batch_size,
        draft_tokens=draft_tokens,
        acceptance_rate=acceptance_rate,
        hardware_price_usd=hardware_price_usd,
        electricity_rate_per_kwh=electricity_rate_per_kwh,
        power_draw_watts=power_draw_watts,
        amortization_months=amortization_months,
        architecture=architecture,
        context_length=context_length,
        precision_bytes=precision_bytes,
        flags=flags,
        dry_run=dry_run,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    model: ComputeInferenceModel | Unset = UNSET,
    prompt_tokens: float | Unset = UNSET,
    output_tokens: float | Unset = UNSET,
    prefill_speed: float | Unset = UNSET,
    decode_speed: float | Unset = UNSET,
    num_turns: int | Unset = UNSET,
    enable_prefix_caching: bool | Unset = UNSET,
    batch_size: int | Unset = UNSET,
    draft_tokens: int | Unset = UNSET,
    acceptance_rate: float | Unset = UNSET,
    hardware_price_usd: float | Unset = UNSET,
    electricity_rate_per_kwh: float | Unset = UNSET,
    power_draw_watts: float | Unset = UNSET,
    amortization_months: float | Unset = UNSET,
    architecture: ComputeInferenceArchitecture | Unset = UNSET,
    context_length: int | Unset = UNSET,
    precision_bytes: float | Unset = UNSET,
    flags: str | Unset = UNSET,
    dry_run: bool | Unset = UNSET,
) -> ComputeResponse | Problem | None:
    r"""Run inference math (TTFT, TPOT, walltime, VRAM)

     Pass ?model=<name> plus parameters. Omit model for a self-describing capability list. Also accepts
    POST with a JSON body, or a batch of up to 50 parameter sets via POST {\"batch\": [...]} / GET
    ?batch=[...] — returns per-index results with per-item ok/error status. Every computation response
    carries a deterministic `id` (calc_<hash> of the resolved inputs) that can be replayed via
    /api/calc/{id}.

    Args:
        model (ComputeInferenceModel | Unset):
        prompt_tokens (float | Unset):
        output_tokens (float | Unset):
        prefill_speed (float | Unset):
        decode_speed (float | Unset):
        num_turns (int | Unset):
        enable_prefix_caching (bool | Unset):
        batch_size (int | Unset):
        draft_tokens (int | Unset):
        acceptance_rate (float | Unset):
        hardware_price_usd (float | Unset):
        electricity_rate_per_kwh (float | Unset):
        power_draw_watts (float | Unset):
        amortization_months (float | Unset):
        architecture (ComputeInferenceArchitecture | Unset):
        context_length (int | Unset):
        precision_bytes (float | Unset): kvCache precision in bytes/value: 2=FP16, 1=FP8, 0.5=INT4
        flags (str | Unset):
        dry_run (bool | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ComputeResponse | Problem
    """

    return (
        await asyncio_detailed(
            client=client,
            model=model,
            prompt_tokens=prompt_tokens,
            output_tokens=output_tokens,
            prefill_speed=prefill_speed,
            decode_speed=decode_speed,
            num_turns=num_turns,
            enable_prefix_caching=enable_prefix_caching,
            batch_size=batch_size,
            draft_tokens=draft_tokens,
            acceptance_rate=acceptance_rate,
            hardware_price_usd=hardware_price_usd,
            electricity_rate_per_kwh=electricity_rate_per_kwh,
            power_draw_watts=power_draw_watts,
            amortization_months=amortization_months,
            architecture=architecture,
            context_length=context_length,
            precision_bytes=precision_bytes,
            flags=flags,
            dry_run=dry_run,
        )
    ).parsed
