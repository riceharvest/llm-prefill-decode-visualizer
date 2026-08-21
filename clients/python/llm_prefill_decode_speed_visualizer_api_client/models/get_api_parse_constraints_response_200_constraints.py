from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.get_api_parse_constraints_response_200_constraints_deployment import GetApiParseConstraintsResponse200ConstraintsDeployment
from ..models.get_api_parse_constraints_response_200_constraints_hw_class import GetApiParseConstraintsResponse200ConstraintsHwClass
from ..types import UNSET, Unset
from typing import cast






T = TypeVar("T", bound="GetApiParseConstraintsResponse200Constraints")



@_attrs_define
class GetApiParseConstraintsResponse200Constraints:
    """ 
        Attributes:
            deployment (GetApiParseConstraintsResponse200ConstraintsDeployment | Unset):
            model_family (None | str | Unset):
            params_b (float | None | Unset):
            quantization (None | str | Unset):
            context_length (int | None | Unset):
            concurrency (int | None | Unset):
            budget_usd_max (float | None | Unset):
            min_decode_tok_per_sec (float | None | Unset):
            max_vram_gb (float | None | Unset):
            hw_class (GetApiParseConstraintsResponse200ConstraintsHwClass | Unset):
     """

    deployment: GetApiParseConstraintsResponse200ConstraintsDeployment | Unset = UNSET
    model_family: None | str | Unset = UNSET
    params_b: float | None | Unset = UNSET
    quantization: None | str | Unset = UNSET
    context_length: int | None | Unset = UNSET
    concurrency: int | None | Unset = UNSET
    budget_usd_max: float | None | Unset = UNSET
    min_decode_tok_per_sec: float | None | Unset = UNSET
    max_vram_gb: float | None | Unset = UNSET
    hw_class: GetApiParseConstraintsResponse200ConstraintsHwClass | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        deployment: str | Unset = UNSET
        if not isinstance(self.deployment, Unset):
            deployment = self.deployment.value


        model_family: None | str | Unset
        if isinstance(self.model_family, Unset):
            model_family = UNSET
        else:
            model_family = self.model_family

        params_b: float | None | Unset
        if isinstance(self.params_b, Unset):
            params_b = UNSET
        else:
            params_b = self.params_b

        quantization: None | str | Unset
        if isinstance(self.quantization, Unset):
            quantization = UNSET
        else:
            quantization = self.quantization

        context_length: int | None | Unset
        if isinstance(self.context_length, Unset):
            context_length = UNSET
        else:
            context_length = self.context_length

        concurrency: int | None | Unset
        if isinstance(self.concurrency, Unset):
            concurrency = UNSET
        else:
            concurrency = self.concurrency

        budget_usd_max: float | None | Unset
        if isinstance(self.budget_usd_max, Unset):
            budget_usd_max = UNSET
        else:
            budget_usd_max = self.budget_usd_max

        min_decode_tok_per_sec: float | None | Unset
        if isinstance(self.min_decode_tok_per_sec, Unset):
            min_decode_tok_per_sec = UNSET
        else:
            min_decode_tok_per_sec = self.min_decode_tok_per_sec

        max_vram_gb: float | None | Unset
        if isinstance(self.max_vram_gb, Unset):
            max_vram_gb = UNSET
        else:
            max_vram_gb = self.max_vram_gb

        hw_class: str | Unset = UNSET
        if not isinstance(self.hw_class, Unset):
            hw_class = self.hw_class.value



        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if deployment is not UNSET:
            field_dict["deployment"] = deployment
        if model_family is not UNSET:
            field_dict["modelFamily"] = model_family
        if params_b is not UNSET:
            field_dict["paramsB"] = params_b
        if quantization is not UNSET:
            field_dict["quantization"] = quantization
        if context_length is not UNSET:
            field_dict["contextLength"] = context_length
        if concurrency is not UNSET:
            field_dict["concurrency"] = concurrency
        if budget_usd_max is not UNSET:
            field_dict["budgetUsdMax"] = budget_usd_max
        if min_decode_tok_per_sec is not UNSET:
            field_dict["minDecodeTokPerSec"] = min_decode_tok_per_sec
        if max_vram_gb is not UNSET:
            field_dict["maxVramGb"] = max_vram_gb
        if hw_class is not UNSET:
            field_dict["hwClass"] = hw_class

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _deployment = d.pop("deployment", UNSET)
        deployment: GetApiParseConstraintsResponse200ConstraintsDeployment | Unset
        if isinstance(_deployment,  Unset):
            deployment = UNSET
        else:
            deployment = GetApiParseConstraintsResponse200ConstraintsDeployment(_deployment)




        def _parse_model_family(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        model_family = _parse_model_family(d.pop("modelFamily", UNSET))


        def _parse_params_b(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        params_b = _parse_params_b(d.pop("paramsB", UNSET))


        def _parse_quantization(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        quantization = _parse_quantization(d.pop("quantization", UNSET))


        def _parse_context_length(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        context_length = _parse_context_length(d.pop("contextLength", UNSET))


        def _parse_concurrency(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        concurrency = _parse_concurrency(d.pop("concurrency", UNSET))


        def _parse_budget_usd_max(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        budget_usd_max = _parse_budget_usd_max(d.pop("budgetUsdMax", UNSET))


        def _parse_min_decode_tok_per_sec(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        min_decode_tok_per_sec = _parse_min_decode_tok_per_sec(d.pop("minDecodeTokPerSec", UNSET))


        def _parse_max_vram_gb(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        max_vram_gb = _parse_max_vram_gb(d.pop("maxVramGb", UNSET))


        _hw_class = d.pop("hwClass", UNSET)
        hw_class: GetApiParseConstraintsResponse200ConstraintsHwClass | Unset
        if isinstance(_hw_class,  Unset):
            hw_class = UNSET
        else:
            hw_class = GetApiParseConstraintsResponse200ConstraintsHwClass(_hw_class)




        get_api_parse_constraints_response_200_constraints = cls(
            deployment=deployment,
            model_family=model_family,
            params_b=params_b,
            quantization=quantization,
            context_length=context_length,
            concurrency=concurrency,
            budget_usd_max=budget_usd_max,
            min_decode_tok_per_sec=min_decode_tok_per_sec,
            max_vram_gb=max_vram_gb,
            hw_class=hw_class,
        )


        get_api_parse_constraints_response_200_constraints.additional_properties = d
        return get_api_parse_constraints_response_200_constraints

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
