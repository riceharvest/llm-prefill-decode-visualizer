from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="CreateWatchBody")


@_attrs_define
class CreateWatchBody:
    """Watched combo. At least one of 'model' / 'hardware' is required; 'quant' optional; 'webhookUrl' must be https when
    present.

        Attributes:
            model (str | Unset): Model family/name substring to match
            hardware (str | Unset): Hardware key or label substring to match
            quant (None | str | Unset): Exact quantization match (optional)
            webhook_url (str | Unset): https-only webhook notified of new matching runs
    """

    model: str | Unset = UNSET
    hardware: str | Unset = UNSET
    quant: None | str | Unset = UNSET
    webhook_url: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        model = self.model

        hardware = self.hardware

        quant: None | str | Unset
        if isinstance(self.quant, Unset):
            quant = UNSET
        else:
            quant = self.quant

        webhook_url = self.webhook_url

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if model is not UNSET:
            field_dict["model"] = model
        if hardware is not UNSET:
            field_dict["hardware"] = hardware
        if quant is not UNSET:
            field_dict["quant"] = quant
        if webhook_url is not UNSET:
            field_dict["webhookUrl"] = webhook_url

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        model = d.pop("model", UNSET)

        hardware = d.pop("hardware", UNSET)

        def _parse_quant(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        quant = _parse_quant(d.pop("quant", UNSET))

        webhook_url = d.pop("webhookUrl", UNSET)

        create_watch_body = cls(
            model=model,
            hardware=hardware,
            quant=quant,
            webhook_url=webhook_url,
        )

        create_watch_body.additional_properties = d
        return create_watch_body

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
