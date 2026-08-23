from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast
import datetime






T = TypeVar("T", bound="BestRunSummary")



@_attrs_define
class BestRunSummary:
    """ The single fastest measured run inside a group.

        Attributes:
            run_id (int):
            decode_tok_per_sec (int):
            model_name (None | str | Unset):
            hardware (None | str | Unset):
            engine (None | str | Unset):
            engine_version (None | str | Unset):
            quantization (None | str | Unset):
            prefill_tok_per_sec (int | Unset):
            created_at (datetime.datetime | None | Unset):
            source (None | str | Unset): Upstream run page
     """

    run_id: int
    decode_tok_per_sec: int
    model_name: None | str | Unset = UNSET
    hardware: None | str | Unset = UNSET
    engine: None | str | Unset = UNSET
    engine_version: None | str | Unset = UNSET
    quantization: None | str | Unset = UNSET
    prefill_tok_per_sec: int | Unset = UNSET
    created_at: datetime.datetime | None | Unset = UNSET
    source: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        run_id = self.run_id

        decode_tok_per_sec = self.decode_tok_per_sec

        model_name: None | str | Unset
        if isinstance(self.model_name, Unset):
            model_name = UNSET
        else:
            model_name = self.model_name

        hardware: None | str | Unset
        if isinstance(self.hardware, Unset):
            hardware = UNSET
        else:
            hardware = self.hardware

        engine: None | str | Unset
        if isinstance(self.engine, Unset):
            engine = UNSET
        else:
            engine = self.engine

        engine_version: None | str | Unset
        if isinstance(self.engine_version, Unset):
            engine_version = UNSET
        else:
            engine_version = self.engine_version

        quantization: None | str | Unset
        if isinstance(self.quantization, Unset):
            quantization = UNSET
        else:
            quantization = self.quantization

        prefill_tok_per_sec = self.prefill_tok_per_sec

        created_at: None | str | Unset
        if isinstance(self.created_at, Unset):
            created_at = UNSET
        elif isinstance(self.created_at, datetime.datetime):
            created_at = self.created_at.isoformat()
        else:
            created_at = self.created_at

        source: None | str | Unset
        if isinstance(self.source, Unset):
            source = UNSET
        else:
            source = self.source


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "runId": run_id,
            "decodeTokPerSec": decode_tok_per_sec,
        })
        if model_name is not UNSET:
            field_dict["modelName"] = model_name
        if hardware is not UNSET:
            field_dict["hardware"] = hardware
        if engine is not UNSET:
            field_dict["engine"] = engine
        if engine_version is not UNSET:
            field_dict["engineVersion"] = engine_version
        if quantization is not UNSET:
            field_dict["quantization"] = quantization
        if prefill_tok_per_sec is not UNSET:
            field_dict["prefillTokPerSec"] = prefill_tok_per_sec
        if created_at is not UNSET:
            field_dict["createdAt"] = created_at
        if source is not UNSET:
            field_dict["source"] = source

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        run_id = d.pop("runId")

        decode_tok_per_sec = d.pop("decodeTokPerSec")

        def _parse_model_name(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        model_name = _parse_model_name(d.pop("modelName", UNSET))


        def _parse_hardware(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        hardware = _parse_hardware(d.pop("hardware", UNSET))


        def _parse_engine(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        engine = _parse_engine(d.pop("engine", UNSET))


        def _parse_engine_version(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        engine_version = _parse_engine_version(d.pop("engineVersion", UNSET))


        def _parse_quantization(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        quantization = _parse_quantization(d.pop("quantization", UNSET))


        prefill_tok_per_sec = d.pop("prefillTokPerSec", UNSET)

        def _parse_created_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                created_at_type_0 = datetime.datetime.fromisoformat(data)



                return created_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        created_at = _parse_created_at(d.pop("createdAt", UNSET))


        def _parse_source(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        source = _parse_source(d.pop("source", UNSET))


        best_run_summary = cls(
            run_id=run_id,
            decode_tok_per_sec=decode_tok_per_sec,
            model_name=model_name,
            hardware=hardware,
            engine=engine,
            engine_version=engine_version,
            quantization=quantization,
            prefill_tok_per_sec=prefill_tok_per_sec,
            created_at=created_at,
            source=source,
        )


        best_run_summary.additional_properties = d
        return best_run_summary

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
