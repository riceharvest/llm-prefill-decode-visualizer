from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.parse_constraints_response_200_ambiguities_item import ParseConstraintsResponse200AmbiguitiesItem
    from ..models.parse_constraints_response_200_constraints import ParseConstraintsResponse200Constraints


T = TypeVar("T", bound="ParseConstraintsResponse200")


@_attrs_define
class ParseConstraintsResponse200:
    """
    Attributes:
        input_ (str | Unset):
        recognized_count (int | Unset):
        constraints (ParseConstraintsResponse200Constraints | Unset):
        ambiguities (list[ParseConstraintsResponse200AmbiguitiesItem] | Unset):
        sizing_query (None | str | Unset): Ready-made /api/sizing query string; null when nothing mappable was
            recognized
    """

    input_: str | Unset = UNSET
    recognized_count: int | Unset = UNSET
    constraints: ParseConstraintsResponse200Constraints | Unset = UNSET
    ambiguities: list[ParseConstraintsResponse200AmbiguitiesItem] | Unset = UNSET
    sizing_query: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        input_ = self.input_

        recognized_count = self.recognized_count

        constraints: dict[str, Any] | Unset = UNSET
        if not isinstance(self.constraints, Unset):
            constraints = self.constraints.to_dict()

        ambiguities: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.ambiguities, Unset):
            ambiguities = []
            for ambiguities_item_data in self.ambiguities:
                ambiguities_item = ambiguities_item_data.to_dict()
                ambiguities.append(ambiguities_item)

        sizing_query: None | str | Unset
        if isinstance(self.sizing_query, Unset):
            sizing_query = UNSET
        else:
            sizing_query = self.sizing_query

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if input_ is not UNSET:
            field_dict["input"] = input_
        if recognized_count is not UNSET:
            field_dict["recognizedCount"] = recognized_count
        if constraints is not UNSET:
            field_dict["constraints"] = constraints
        if ambiguities is not UNSET:
            field_dict["ambiguities"] = ambiguities
        if sizing_query is not UNSET:
            field_dict["sizingQuery"] = sizing_query

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.parse_constraints_response_200_ambiguities_item import ParseConstraintsResponse200AmbiguitiesItem
        from ..models.parse_constraints_response_200_constraints import ParseConstraintsResponse200Constraints

        d = dict(src_dict)
        input_ = d.pop("input", UNSET)

        recognized_count = d.pop("recognizedCount", UNSET)

        _constraints = d.pop("constraints", UNSET)
        constraints: ParseConstraintsResponse200Constraints | Unset
        if isinstance(_constraints, Unset):
            constraints = UNSET
        else:
            constraints = ParseConstraintsResponse200Constraints.from_dict(_constraints)

        _ambiguities = d.pop("ambiguities", UNSET)
        ambiguities: list[ParseConstraintsResponse200AmbiguitiesItem] | Unset = UNSET
        if _ambiguities is not UNSET:
            ambiguities = []
            for ambiguities_item_data in _ambiguities:
                ambiguities_item = ParseConstraintsResponse200AmbiguitiesItem.from_dict(ambiguities_item_data)

                ambiguities.append(ambiguities_item)

        def _parse_sizing_query(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        sizing_query = _parse_sizing_query(d.pop("sizingQuery", UNSET))

        parse_constraints_response_200 = cls(
            input_=input_,
            recognized_count=recognized_count,
            constraints=constraints,
            ambiguities=ambiguities,
            sizing_query=sizing_query,
        )

        parse_constraints_response_200.additional_properties = d
        return parse_constraints_response_200

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
