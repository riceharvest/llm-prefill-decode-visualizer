from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.best_list_envelope_context_band_type_1 import BestListEnvelopeContextBandType1
from ..models.best_list_envelope_context_band_type_2_type_1 import BestListEnvelopeContextBandType2Type1
from ..models.best_list_envelope_context_band_type_3_type_1 import BestListEnvelopeContextBandType3Type1
from ..models.best_list_envelope_ranked_by import BestListEnvelopeRankedBy
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.best_result import BestResult
    from ..models.caveat import Caveat
    from ..models.snapshot_ref import SnapshotRef


T = TypeVar("T", bound="BestListEnvelope")


@_attrs_define
class BestListEnvelope:
    """Ranked recommendations. Carries a deterministic `id` (hash of the resolved filters) replayable via
    /api/calc/{id}?endpoint=best&<same filters>.

        Attributes:
            ranked_by (BestListEnvelopeRankedBy):
            caveats (list[Caveat]):
            warnings (list[str]): Human-readable group-level warnings (mixed engine versions / context bands)
            results (list[BestResult]):
            id (str | Unset):
            description (str | Unset):
            snapshot (SnapshotRef | Unset): Content-addressed dataset snapshot actually served. Pin its id via ?snapshot=
                for reproducible numbers (see /api/snapshots).
            snapshot_at (datetime.datetime | None | Unset):
            matched_runs (int | Unset): Comparable runs that survived filtering
            excluded_runs (int | None | Unset): Runs dropped by ?fitCheck= (present only with fitCheck)
            max_age_days (float | None | Unset): Echoed ?max_age= filter (null when unset)
            context_band (BestListEnvelopeContextBandType1 | BestListEnvelopeContextBandType2Type1 |
                BestListEnvelopeContextBandType3Type1 | None | Unset): Echoed ?context_band= filter (null when unset)
            schema_version (Literal['1'] | Unset):
    """

    ranked_by: BestListEnvelopeRankedBy
    caveats: list[Caveat]
    warnings: list[str]
    results: list[BestResult]
    id: str | Unset = UNSET
    description: str | Unset = UNSET
    snapshot: SnapshotRef | Unset = UNSET
    snapshot_at: datetime.datetime | None | Unset = UNSET
    matched_runs: int | Unset = UNSET
    excluded_runs: int | None | Unset = UNSET
    max_age_days: float | None | Unset = UNSET
    context_band: (
        BestListEnvelopeContextBandType1
        | BestListEnvelopeContextBandType2Type1
        | BestListEnvelopeContextBandType3Type1
        | None
        | Unset
    ) = UNSET
    schema_version: Literal["1"] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        ranked_by = self.ranked_by.value

        caveats = []
        for caveats_item_data in self.caveats:
            caveats_item = caveats_item_data.to_dict()
            caveats.append(caveats_item)

        warnings = self.warnings

        results = []
        for results_item_data in self.results:
            results_item = results_item_data.to_dict()
            results.append(results_item)

        id = self.id

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

        matched_runs = self.matched_runs

        excluded_runs: int | None | Unset
        if isinstance(self.excluded_runs, Unset):
            excluded_runs = UNSET
        else:
            excluded_runs = self.excluded_runs

        max_age_days: float | None | Unset
        if isinstance(self.max_age_days, Unset):
            max_age_days = UNSET
        else:
            max_age_days = self.max_age_days

        context_band: None | str | Unset
        if isinstance(self.context_band, Unset):
            context_band = UNSET
        elif isinstance(self.context_band, BestListEnvelopeContextBandType1):
            context_band = self.context_band.value
        elif isinstance(self.context_band, BestListEnvelopeContextBandType2Type1):
            context_band = self.context_band.value
        elif isinstance(self.context_band, BestListEnvelopeContextBandType3Type1):
            context_band = self.context_band.value
        else:
            context_band = self.context_band

        schema_version = self.schema_version

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "rankedBy": ranked_by,
                "caveats": caveats,
                "warnings": warnings,
                "results": results,
            }
        )
        if id is not UNSET:
            field_dict["id"] = id
        if description is not UNSET:
            field_dict["description"] = description
        if snapshot is not UNSET:
            field_dict["snapshot"] = snapshot
        if snapshot_at is not UNSET:
            field_dict["snapshotAt"] = snapshot_at
        if matched_runs is not UNSET:
            field_dict["matchedRuns"] = matched_runs
        if excluded_runs is not UNSET:
            field_dict["excludedRuns"] = excluded_runs
        if max_age_days is not UNSET:
            field_dict["maxAgeDays"] = max_age_days
        if context_band is not UNSET:
            field_dict["contextBand"] = context_band
        if schema_version is not UNSET:
            field_dict["schema_version"] = schema_version

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.best_result import BestResult
        from ..models.caveat import Caveat
        from ..models.snapshot_ref import SnapshotRef

        d = dict(src_dict)
        ranked_by = BestListEnvelopeRankedBy(d.pop("rankedBy"))

        caveats = []
        _caveats = d.pop("caveats")
        for caveats_item_data in _caveats:
            caveats_item = Caveat.from_dict(caveats_item_data)

            caveats.append(caveats_item)

        warnings = cast(list[str], d.pop("warnings"))

        results = []
        _results = d.pop("results")
        for results_item_data in _results:
            results_item = BestResult.from_dict(results_item_data)

            results.append(results_item)

        id = d.pop("id", UNSET)

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

        matched_runs = d.pop("matchedRuns", UNSET)

        def _parse_excluded_runs(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        excluded_runs = _parse_excluded_runs(d.pop("excludedRuns", UNSET))

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
            BestListEnvelopeContextBandType1
            | BestListEnvelopeContextBandType2Type1
            | BestListEnvelopeContextBandType3Type1
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
                context_band_type_1 = BestListEnvelopeContextBandType1(data)

                return context_band_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                context_band_type_2_type_1 = BestListEnvelopeContextBandType2Type1(data)

                return context_band_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                context_band_type_3_type_1 = BestListEnvelopeContextBandType3Type1(data)

                return context_band_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                BestListEnvelopeContextBandType1
                | BestListEnvelopeContextBandType2Type1
                | BestListEnvelopeContextBandType3Type1
                | None
                | Unset,
                data,
            )

        context_band = _parse_context_band(d.pop("contextBand", UNSET))

        schema_version = cast(Literal["1"] | Unset, d.pop("schema_version", UNSET))
        if schema_version != "1" and not isinstance(schema_version, Unset):
            raise ValueError(f"schema_version must match const '1', got '{schema_version}'")

        best_list_envelope = cls(
            ranked_by=ranked_by,
            caveats=caveats,
            warnings=warnings,
            results=results,
            id=id,
            description=description,
            snapshot=snapshot,
            snapshot_at=snapshot_at,
            matched_runs=matched_runs,
            excluded_runs=excluded_runs,
            max_age_days=max_age_days,
            context_band=context_band,
            schema_version=schema_version,
        )

        best_list_envelope.additional_properties = d
        return best_list_envelope

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
