from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.hardware_summary_envelope_hardware_groups_item_hw_class_type_1 import HardwareSummaryEnvelopeHardwareGroupsItemHwClassType1
from ..models.hardware_summary_envelope_hardware_groups_item_hw_class_type_2_type_1 import HardwareSummaryEnvelopeHardwareGroupsItemHwClassType2Type1
from ..models.hardware_summary_envelope_hardware_groups_item_hw_class_type_3_type_1 import HardwareSummaryEnvelopeHardwareGroupsItemHwClassType3Type1
from ..models.hardware_summary_envelope_hardware_groups_item_staleness_type_1 import HardwareSummaryEnvelopeHardwareGroupsItemStalenessType1
from ..models.hardware_summary_envelope_hardware_groups_item_staleness_type_2_type_1 import HardwareSummaryEnvelopeHardwareGroupsItemStalenessType2Type1
from ..models.hardware_summary_envelope_hardware_groups_item_staleness_type_3_type_1 import HardwareSummaryEnvelopeHardwareGroupsItemStalenessType3Type1
from ..types import UNSET, Unset
from typing import cast
import datetime






T = TypeVar("T", bound="HardwareSummaryEnvelopeHardwareGroupsItem")



@_attrs_define
class HardwareSummaryEnvelopeHardwareGroupsItem:
    """ 
        Attributes:
            hardware (None | str | Unset):
            hardware_key (None | str | Unset):
            hw_class (HardwareSummaryEnvelopeHardwareGroupsItemHwClassType1 |
                HardwareSummaryEnvelopeHardwareGroupsItemHwClassType2Type1 |
                HardwareSummaryEnvelopeHardwareGroupsItemHwClassType3Type1 | None | Unset):
            runs (int | Unset):
            distinct_model_families (int | Unset):
            staleness (HardwareSummaryEnvelopeHardwareGroupsItemStalenessType1 |
                HardwareSummaryEnvelopeHardwareGroupsItemStalenessType2Type1 |
                HardwareSummaryEnvelopeHardwareGroupsItemStalenessType3Type1 | None | Unset):
            newest_run_at (datetime.datetime | None | Unset):
     """

    hardware: None | str | Unset = UNSET
    hardware_key: None | str | Unset = UNSET
    hw_class: HardwareSummaryEnvelopeHardwareGroupsItemHwClassType1 | HardwareSummaryEnvelopeHardwareGroupsItemHwClassType2Type1 | HardwareSummaryEnvelopeHardwareGroupsItemHwClassType3Type1 | None | Unset = UNSET
    runs: int | Unset = UNSET
    distinct_model_families: int | Unset = UNSET
    staleness: HardwareSummaryEnvelopeHardwareGroupsItemStalenessType1 | HardwareSummaryEnvelopeHardwareGroupsItemStalenessType2Type1 | HardwareSummaryEnvelopeHardwareGroupsItemStalenessType3Type1 | None | Unset = UNSET
    newest_run_at: datetime.datetime | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        hardware: None | str | Unset
        if isinstance(self.hardware, Unset):
            hardware = UNSET
        else:
            hardware = self.hardware

        hardware_key: None | str | Unset
        if isinstance(self.hardware_key, Unset):
            hardware_key = UNSET
        else:
            hardware_key = self.hardware_key

        hw_class: None | str | Unset
        if isinstance(self.hw_class, Unset):
            hw_class = UNSET
        elif isinstance(self.hw_class, HardwareSummaryEnvelopeHardwareGroupsItemHwClassType1):
            hw_class = self.hw_class.value
        elif isinstance(self.hw_class, HardwareSummaryEnvelopeHardwareGroupsItemHwClassType2Type1):
            hw_class = self.hw_class.value
        elif isinstance(self.hw_class, HardwareSummaryEnvelopeHardwareGroupsItemHwClassType3Type1):
            hw_class = self.hw_class.value
        else:
            hw_class = self.hw_class

        runs = self.runs

        distinct_model_families = self.distinct_model_families

        staleness: None | str | Unset
        if isinstance(self.staleness, Unset):
            staleness = UNSET
        elif isinstance(self.staleness, HardwareSummaryEnvelopeHardwareGroupsItemStalenessType1):
            staleness = self.staleness.value
        elif isinstance(self.staleness, HardwareSummaryEnvelopeHardwareGroupsItemStalenessType2Type1):
            staleness = self.staleness.value
        elif isinstance(self.staleness, HardwareSummaryEnvelopeHardwareGroupsItemStalenessType3Type1):
            staleness = self.staleness.value
        else:
            staleness = self.staleness

        newest_run_at: None | str | Unset
        if isinstance(self.newest_run_at, Unset):
            newest_run_at = UNSET
        elif isinstance(self.newest_run_at, datetime.datetime):
            newest_run_at = self.newest_run_at.isoformat()
        else:
            newest_run_at = self.newest_run_at


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if hardware is not UNSET:
            field_dict["hardware"] = hardware
        if hardware_key is not UNSET:
            field_dict["hardwareKey"] = hardware_key
        if hw_class is not UNSET:
            field_dict["hwClass"] = hw_class
        if runs is not UNSET:
            field_dict["runs"] = runs
        if distinct_model_families is not UNSET:
            field_dict["distinctModelFamilies"] = distinct_model_families
        if staleness is not UNSET:
            field_dict["staleness"] = staleness
        if newest_run_at is not UNSET:
            field_dict["newestRunAt"] = newest_run_at

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        def _parse_hardware(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        hardware = _parse_hardware(d.pop("hardware", UNSET))


        def _parse_hardware_key(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        hardware_key = _parse_hardware_key(d.pop("hardwareKey", UNSET))


        def _parse_hw_class(data: object) -> HardwareSummaryEnvelopeHardwareGroupsItemHwClassType1 | HardwareSummaryEnvelopeHardwareGroupsItemHwClassType2Type1 | HardwareSummaryEnvelopeHardwareGroupsItemHwClassType3Type1 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                hw_class_type_1 = HardwareSummaryEnvelopeHardwareGroupsItemHwClassType1(data)



                return hw_class_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                hw_class_type_2_type_1 = HardwareSummaryEnvelopeHardwareGroupsItemHwClassType2Type1(data)



                return hw_class_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                hw_class_type_3_type_1 = HardwareSummaryEnvelopeHardwareGroupsItemHwClassType3Type1(data)



                return hw_class_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(HardwareSummaryEnvelopeHardwareGroupsItemHwClassType1 | HardwareSummaryEnvelopeHardwareGroupsItemHwClassType2Type1 | HardwareSummaryEnvelopeHardwareGroupsItemHwClassType3Type1 | None | Unset, data)

        hw_class = _parse_hw_class(d.pop("hwClass", UNSET))


        runs = d.pop("runs", UNSET)

        distinct_model_families = d.pop("distinctModelFamilies", UNSET)

        def _parse_staleness(data: object) -> HardwareSummaryEnvelopeHardwareGroupsItemStalenessType1 | HardwareSummaryEnvelopeHardwareGroupsItemStalenessType2Type1 | HardwareSummaryEnvelopeHardwareGroupsItemStalenessType3Type1 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                staleness_type_1 = HardwareSummaryEnvelopeHardwareGroupsItemStalenessType1(data)



                return staleness_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                staleness_type_2_type_1 = HardwareSummaryEnvelopeHardwareGroupsItemStalenessType2Type1(data)



                return staleness_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                staleness_type_3_type_1 = HardwareSummaryEnvelopeHardwareGroupsItemStalenessType3Type1(data)



                return staleness_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(HardwareSummaryEnvelopeHardwareGroupsItemStalenessType1 | HardwareSummaryEnvelopeHardwareGroupsItemStalenessType2Type1 | HardwareSummaryEnvelopeHardwareGroupsItemStalenessType3Type1 | None | Unset, data)

        staleness = _parse_staleness(d.pop("staleness", UNSET))


        def _parse_newest_run_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                newest_run_at_type_0 = datetime.datetime.fromisoformat(data)



                return newest_run_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        newest_run_at = _parse_newest_run_at(d.pop("newestRunAt", UNSET))


        hardware_summary_envelope_hardware_groups_item = cls(
            hardware=hardware,
            hardware_key=hardware_key,
            hw_class=hw_class,
            runs=runs,
            distinct_model_families=distinct_model_families,
            staleness=staleness,
            newest_run_at=newest_run_at,
        )


        hardware_summary_envelope_hardware_groups_item.additional_properties = d
        return hardware_summary_envelope_hardware_groups_item

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
