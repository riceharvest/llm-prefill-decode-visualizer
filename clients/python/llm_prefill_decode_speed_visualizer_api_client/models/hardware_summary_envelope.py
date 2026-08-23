from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.hardware_summary_envelope_context_band_type_1 import HardwareSummaryEnvelopeContextBandType1
from ..models.hardware_summary_envelope_context_band_type_2_type_1 import HardwareSummaryEnvelopeContextBandType2Type1
from ..models.hardware_summary_envelope_context_band_type_3_type_1 import HardwareSummaryEnvelopeContextBandType3Type1
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.caveat import Caveat
    from ..models.hardware_summary_envelope_hardware_groups_item import HardwareSummaryEnvelopeHardwareGroupsItem
    from ..models.snapshot_ref import SnapshotRef


T = TypeVar("T", bound="HardwareSummaryEnvelope")


@_attrs_define
class HardwareSummaryEnvelope:
    """Bare call (no hardware/model/quant filter): one summary row per hardware group, largest first.

    Attributes:
        total_comparable_runs (int):
        hardware_groups (list[HardwareSummaryEnvelopeHardwareGroupsItem]):
        description (str | Unset):
        snapshot (SnapshotRef | Unset): Content-addressed dataset snapshot actually served. Pin its id via ?snapshot=
            for reproducible numbers (see /api/snapshots).
        snapshot_at (datetime.datetime | None | Unset):
        max_age_days (float | None | Unset):
        context_band (HardwareSummaryEnvelopeContextBandType1 | HardwareSummaryEnvelopeContextBandType2Type1 |
            HardwareSummaryEnvelopeContextBandType3Type1 | None | Unset):
        caveats (list[Caveat] | Unset):
        schema_version (Literal['1'] | Unset):
    """

    total_comparable_runs: int
    hardware_groups: list[HardwareSummaryEnvelopeHardwareGroupsItem]
    description: str | Unset = UNSET
    snapshot: SnapshotRef | Unset = UNSET
    snapshot_at: datetime.datetime | None | Unset = UNSET
    max_age_days: float | None | Unset = UNSET
    context_band: (
        HardwareSummaryEnvelopeContextBandType1
        | HardwareSummaryEnvelopeContextBandType2Type1
        | HardwareSummaryEnvelopeContextBandType3Type1
        | None
        | Unset
    ) = UNSET
    caveats: list[Caveat] | Unset = UNSET
    schema_version: Literal["1"] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        total_comparable_runs = self.total_comparable_runs

        hardware_groups = []
        for hardware_groups_item_data in self.hardware_groups:
            hardware_groups_item = hardware_groups_item_data.to_dict()
            hardware_groups.append(hardware_groups_item)

        description = self.description

        snapshot: dict[str, Any] | Unset = UNSET
        if not isinstance(self.snapshot, Unset):
            snapshot = self.snapshot.to_dict()

        snapshot_at: None | str | Unset
        if isinstance(self.snapshot_at, Unset):
            snapshot_at = UNSET
        elif isinstance(self.snapshot_at, datetime.datetime):
            snapshot_at = self.snapshot_at.isoformat()
        else:
            snapshot_at = self.snapshot_at

        max_age_days: float | None | Unset
        if isinstance(self.max_age_days, Unset):
            max_age_days = UNSET
        else:
            max_age_days = self.max_age_days

        context_band: None | str | Unset
        if isinstance(self.context_band, Unset):
            context_band = UNSET
        elif isinstance(self.context_band, HardwareSummaryEnvelopeContextBandType1):
            context_band = self.context_band.value
        elif isinstance(self.context_band, HardwareSummaryEnvelopeContextBandType2Type1):
            context_band = self.context_band.value
        elif isinstance(self.context_band, HardwareSummaryEnvelopeContextBandType3Type1):
            context_band = self.context_band.value
        else:
            context_band = self.context_band

        caveats: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.caveats, Unset):
            caveats = []
            for caveats_item_data in self.caveats:
                caveats_item = caveats_item_data.to_dict()
                caveats.append(caveats_item)

        schema_version = self.schema_version

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "totalComparableRuns": total_comparable_runs,
                "hardwareGroups": hardware_groups,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if snapshot is not UNSET:
            field_dict["snapshot"] = snapshot
        if snapshot_at is not UNSET:
            field_dict["snapshotAt"] = snapshot_at
        if max_age_days is not UNSET:
            field_dict["maxAgeDays"] = max_age_days
        if context_band is not UNSET:
            field_dict["contextBand"] = context_band
        if caveats is not UNSET:
            field_dict["caveats"] = caveats
        if schema_version is not UNSET:
            field_dict["schema_version"] = schema_version

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.caveat import Caveat
        from ..models.hardware_summary_envelope_hardware_groups_item import HardwareSummaryEnvelopeHardwareGroupsItem
        from ..models.snapshot_ref import SnapshotRef

        d = dict(src_dict)
        total_comparable_runs = d.pop("totalComparableRuns")

        hardware_groups = []
        _hardware_groups = d.pop("hardwareGroups")
        for hardware_groups_item_data in _hardware_groups:
            hardware_groups_item = HardwareSummaryEnvelopeHardwareGroupsItem.from_dict(hardware_groups_item_data)

            hardware_groups.append(hardware_groups_item)

        description = d.pop("description", UNSET)

        _snapshot = d.pop("snapshot", UNSET)
        snapshot: SnapshotRef | Unset
        if isinstance(_snapshot, Unset):
            snapshot = UNSET
        else:
            snapshot = SnapshotRef.from_dict(_snapshot)

        def _parse_snapshot_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                snapshot_at_type_0 = datetime.datetime.fromisoformat(data)

                return snapshot_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        snapshot_at = _parse_snapshot_at(d.pop("snapshotAt", UNSET))

        def _parse_max_age_days(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        max_age_days = _parse_max_age_days(d.pop("maxAgeDays", UNSET))

        def _parse_context_band(
            data: object,
        ) -> (
            HardwareSummaryEnvelopeContextBandType1
            | HardwareSummaryEnvelopeContextBandType2Type1
            | HardwareSummaryEnvelopeContextBandType3Type1
            | None
            | Unset
        ):
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                context_band_type_1 = HardwareSummaryEnvelopeContextBandType1(data)

                return context_band_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                context_band_type_2_type_1 = HardwareSummaryEnvelopeContextBandType2Type1(data)

                return context_band_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                context_band_type_3_type_1 = HardwareSummaryEnvelopeContextBandType3Type1(data)

                return context_band_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                HardwareSummaryEnvelopeContextBandType1
                | HardwareSummaryEnvelopeContextBandType2Type1
                | HardwareSummaryEnvelopeContextBandType3Type1
                | None
                | Unset,
                data,
            )

        context_band = _parse_context_band(d.pop("contextBand", UNSET))

        _caveats = d.pop("caveats", UNSET)
        caveats: list[Caveat] | Unset = UNSET
        if _caveats is not UNSET:
            caveats = []
            for caveats_item_data in _caveats:
                caveats_item = Caveat.from_dict(caveats_item_data)

                caveats.append(caveats_item)

        schema_version = cast(Literal["1"] | Unset, d.pop("schema_version", UNSET))
        if schema_version != "1" and not isinstance(schema_version, Unset):
            raise ValueError(f"schema_version must match const '1', got '{schema_version}'")

        hardware_summary_envelope = cls(
            total_comparable_runs=total_comparable_runs,
            hardware_groups=hardware_groups,
            description=description,
            snapshot=snapshot,
            snapshot_at=snapshot_at,
            max_age_days=max_age_days,
            context_band=context_band,
            caveats=caveats,
            schema_version=schema_version,
        )

        hardware_summary_envelope.additional_properties = d
        return hardware_summary_envelope

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
