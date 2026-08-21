"""Contains all the data models used in inputs/outputs"""

from .get_api_benchmarks_group_by import GetApiBenchmarksGroupBy
from .get_api_benchmarks_hw_class import GetApiBenchmarksHwClass
from .get_api_best_by import GetApiBestBy
from .get_api_best_hw_class import GetApiBestHwClass
from .get_api_compute_architecture import GetApiComputeArchitecture
from .get_api_compute_model import GetApiComputeModel

__all__ = (
    "GetApiBenchmarksGroupBy",
    "GetApiBenchmarksHwClass",
    "GetApiBestBy",
    "GetApiBestHwClass",
    "GetApiComputeArchitecture",
    "GetApiComputeModel",
)
