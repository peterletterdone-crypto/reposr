import React, { Fragment, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { circleQuestionIcon, downarrowIcon, newFilterIcon, uparrowIcon } from "assets";
import Table from "react-bootstrap/Table";
import { AppDispatch, useTypedSelector } from "redux/store";
import {
  listExamMarksAsync,
  selectExamMarkList,
  selectExamMarkLoading,
  selectExamMarkError,
  updateExamMarksAsync,
  updateStudentAttendanceAsync,
} from "redux/features/examMarkingSlice";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "./style.scss";
import ReactPaginate from "react-paginate";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { Modal, Spinner } from "react-bootstrap";
import { toastError } from "helpers/toastHelper";
import { DisplaySectionDataList, SectionListAsync } from "redux/features/sectionsSlice";
import { Listbox, Transition } from "@headlessui/react";
import { CheckIcon, ChevronUpDownIcon } from "@heroicons/react/20/solid";
import { selectActiveModules } from "redux/features/moduleWiseAccessSlice";
import { Loader } from "components";

const Attendance = [
  { id: 1, name: "present" },
  { id: 2, name: "medical-leave" },
  { id: 3, name: "absent" },
];

// Exam marking Component here //
const ExamMarkingComponent = () => {
  const [currentPage, setCurrentPage] = useState(0);
  const [itemsPerPage] = useState(10);
  const [totalExamCount, setTotalExamCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const dispatch = useDispatch<AppDispatch>();
  const [searchQuery, setSearchQuery] = useState("");
  const [show, setShow] = useState(false);
  const [selectedScholarId, setSelectedScholarId] = useState<number | null>(null);
  const [selectedAttendance, setSelectedAttendance] = useState("");
  const [showFilterModal, setShowFilterModal] = useState(false);
  const handleCloseFilterModal = () => setShowFilterModal(false);
  const handleShowFilterModal = () => setShowFilterModal(true);
  const [sectionSelected, setSectionSelected] = useState<number[]>([]);
  const [formSubmitted, setFormSubmitted] = useState(false);
  const sectionsDataList = useTypedSelector(DisplaySectionDataList);

  const activeModules = useTypedSelector(selectActiveModules);
  const role_id = localStorage.getItem("role_id");

  // Find the user's role and permissions
  const userRole = activeModules.find((ele) => ele.role_id == role_id);

  // Check if the 'exam-marking' module has the 'update' action enabled //
  const hasUpdatePermission = userRole?.modules
    ?.find(module => module.module.toLowerCase() === "exam-marks")
    ?.module_permissions.some(perm => perm.action === "update" && perm.status);

  const [sortConfig, setSortConfig] = useState({
    key: "student_id",
    direction: "DESC",
  });

  const handleSort = (key) => {
    let direction = "ASC";
    if (sortConfig?.key === key && sortConfig?.direction === "ASC") {
      direction = "DESC";
    }

    // Update sorting state
    setSortConfig({ key, direction });

    // Ensure examId is valid before making the API call
    if (examId) {
      dispatch(
        listExamMarksAsync({
          examId: Number(examId),
          sort: {
            field: key,
            order: direction,
          },
          page: currentPage + 1,
          pageSize: itemsPerPage,
        })
      );
    }
  };

  const onHide = () => {
    setShow(false);
  };
  // List data here //
  const examMarks = useSelector(selectExamMarkList);
  const isLoading = useSelector(selectExamMarkLoading);
  const error = useSelector(selectExamMarkError);
  const [showQuestionsScholarId, setShowQuestionsScholarId] = useState<
    number | null
  >(null);

  const [updatedMarks, setUpdatedMarks] = useState<{
    [key: number]: string | number;
  }>({});

  const [selectedQuestionPaperIds, setSelectedQuestionPaperIds] = useState<
    Record<number, string>
  >({});

  const getQuestionMarkKey = (
    questionId: number | string | undefined,
    studentIdentifier?: string | null
  ) => `${questionId ?? ""}-${studentIdentifier ?? ""}`;

  const markValueFallbackKeys = [
    "studentMarks",
    "obtainedMarks",
    "obtained_marks",
    "awarded_marks",
    "currentMarks",
    "marks_obtained",
    "marks_awarded",
    "awardedMarks",
    "marks",
  ];

  const getExistingMarksFromNode = (node: any) => {
    if (!node) {
      return undefined;
    }

    for (const key of markValueFallbackKeys) {
      if (node?.[key] !== undefined && node?.[key] !== null && node?.[key] !== "") {
        const numericValue = Number(node[key]);
        if (!Number.isNaN(numericValue)) {
          return numericValue;
        }
      }
    }

    return undefined;
  };

  const hasCustomMarkValue = (
    marksState: Record<string, string | number>,
    key: string
  ) => Object.prototype.hasOwnProperty.call(marksState ?? {}, key);

  const findCompositeNodeByQuestionId = (
    sections: any[] | undefined,
    questionId: number | string | undefined
  ) => {
    if (!Array.isArray(sections) || questionId === undefined || questionId === null) {
      return null;
    }

    const targetId = Number(questionId);
    if (Number.isNaN(targetId)) {
      return null;
    }

    const traverse = (nodes: any[]): any => {
      if (!Array.isArray(nodes)) {
        return null;
      }

      for (const node of nodes) {
        if (node?.nodeType === "composite" && Number(node?.questionId) === targetId) {
          return node;
        }

        if (Array.isArray(node?.items)) {
          const nested = traverse(node.items);
          if (nested) {
            return nested;
          }
        }
      }

      return null;
    };

    for (const section of sections) {
      const found = traverse(section?.items ?? []);
      if (found) {
        return found;
      }
    }

    return null;
  };

  const calculateCompositeTotalFromChildren = (
    compositeNode: any,
    studentIdentifier: string | null | undefined,
    fallbackMarks: number,
    marksState: Record<string, string | number>,
    subQuestionMeta?: Map<
      number,
      {
        marks: number;
        maxMarks: number;
        isAttempted?: boolean;
      }
    >
  ) => {
    let total = 0;
    let hasValue = false;

    const accumulate = (node: any) => {
      if (!node) {
        return;
      }

      if (node?.nodeType === "question" && node?.questionId !== undefined) {
        const numericId = Number(node.questionId);
        const childKey = getQuestionMarkKey(node.questionId, studentIdentifier);

        // 1) Explicit override from teacher (including 0)
        if (hasCustomMarkValue(marksState, childKey)) {
          const storedValue = Number(marksState[childKey]);
          if (!Number.isNaN(storedValue)) {
            total += storedValue;
          }
          hasValue = true;
          return;
        }

        // 2) Use sub-question meta from API marks (student's obtained marks),
        //    not the definition's max marks on the node itself.
        if (subQuestionMeta && subQuestionMeta.has(numericId)) {
          const meta = subQuestionMeta.get(numericId);
          if (meta) {
            const metaMarks = Number(meta.marks);
            if (!Number.isNaN(metaMarks)) {
              total += metaMarks;
            }
            hasValue = true;
            return;
          }
        }

        // 3) Fallback to any numeric "marks" found on the node as a last resort
        const existing = getExistingMarksFromNode(node);
        if (existing !== undefined) {
          total += existing;
          hasValue = true;
          return;
        }
      }

      if (Array.isArray(node?.items)) {
        node.items.forEach(accumulate);
      }
    };

    if (Array.isArray(compositeNode?.items)) {
      compositeNode.items.forEach(accumulate);
    }

    const fallbackValue = Number(fallbackMarks);
    if (!hasValue) {
      return Number.isNaN(fallbackValue) ? 0 : fallbackValue;
    }

    return total;
  };

  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const examId = searchParams.get("examId");
  const navigate = useNavigate();

  useEffect(() => {
    if (!examId) {
      return;
    }

    const sortPayload =
      sortConfig && sortConfig.key
        ? {
          sort: {
            field: sortConfig.key,
            order: sortConfig.direction,
          },
        }
        : {};

    setLoading(true);
    dispatch(
      listExamMarksAsync({
        examId: parseInt(examId),
        page: currentPage + 1,
        pageSize: itemsPerPage,
        ...sortPayload
      })
    ).then((result) => {
      if (result.payload) {
        setTotalExamCount(result.payload.count);
      }
      setLoading(false);
    });
    dispatch(SectionListAsync({}))
  }, [examId, dispatch]);

  // ---- search ----- ///
  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      if (examId) {
        const payload: any = {
          examId: parseInt(examId),
          page: currentPage + 1,
          pageSize: itemsPerPage,
          searchQuery,
        };

        if (sectionSelected.length > 0) {
          payload.sectionId = sectionSelected;
        }

        if (sortConfig?.key) {
          payload.sort = {
            field: sortConfig.key,
            order: sortConfig.direction,
          };
        }

        dispatch(listExamMarksAsync(payload)).then((result) => {
          if (result?.payload?.count !== undefined) {
            setTotalExamCount(result.payload.count);
          }
          setLoading(false);
        });
      }
    }, 500);

    return () => clearTimeout(delayDebounce);
  }, [searchQuery, sectionSelected, sortConfig, currentPage]);

  // Topics Filter logic here //
  const handleFilterSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormSubmitted(true);

    if (examId) {
      const payload: any = {
        examId: parseInt(examId),
        page: currentPage + 1,
        pageSize: itemsPerPage,
        searchQuery,
        sectionId: sectionSelected,
      };

      if (sortConfig?.key) {
        payload.sort = {
          field: sortConfig.key,
          order: sortConfig.direction,
        };
      }

      dispatch(listExamMarksAsync(payload)).then((result) => {
        if (result?.payload?.count !== undefined) {
          setTotalExamCount(result.payload.count);
        }
        setLoading(false);
      });
      handleCloseFilterModal();
    }
  };

  // // Filter Reset topic logic here //
  const handleResetFilter = () => {
    setSectionSelected([]);
    if (examId) {
      const payload: any = {
        examId: parseInt(examId),
        page: currentPage + 1,
        pageSize: itemsPerPage,
        searchQuery,
      };

      if (sortConfig?.key) {
        payload.sort = {
          field: sortConfig.key,
          order: sortConfig.direction,
        };
      }

      dispatch(listExamMarksAsync(payload)).then((result) => {
        if (result?.payload?.count !== undefined) {
          setTotalExamCount(result.payload.count);
        }
        setLoading(false);
      });
    }
  };

  const toggleShowQuestionsForScholar = (scholarId: number) => {
    setShowQuestionsScholarId(
      showQuestionsScholarId === scholarId ? null : scholarId
    );
  };

  const handleQuestionPaperChange = (
    scholarId: number,
    questionPaperId: string
  ) => {
    setSelectedQuestionPaperIds((prev) => ({
      ...prev,
      [scholarId]: questionPaperId,
    }));
  };

  // search logic here //
  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  // Update Marks Logic here //
  const handleUpdateMarks = async (scholarId: number) => {
    const scholar = examMarks.find((s) => s?.id === scholarId);
    if (!scholar) {
      return;
    }

    const storedQuestionPaperId =
      selectedQuestionPaperIds[scholarId] ??
      scholar?.question_paper?.[0]?.question_paper_id?.toString();
    const activeQuestionPaper =
      scholar?.question_paper?.find(
        (questionPaper) =>
          questionPaper?.question_paper_id?.toString() === storedQuestionPaperId
      ) ?? scholar?.question_paper?.[0];
    if (!activeQuestionPaper) {
      toast.warning("Select a question paper before submitting.");
      return;
    }

    const sectionTree = Array.isArray(activeQuestionPaper?.allSectionData)
      ? activeQuestionPaper?.allSectionData
      : [];
    const studentIdentifier =
      scholar?.user?.f_name || scholar?.student_id || "student";

    const getOverrideMarksAndAttempt = (
      key: string,
      fallbackMarks: number,
      existingIsAttempted?: boolean
    ) => {
      const override = updatedMarks[key];

      // No override: keep existing attempt status from API (default true)
      if (override === undefined) {
        return {
          marks: fallbackMarks,
          isAttempted:
            typeof existingIsAttempted === "boolean"
              ? existingIsAttempted
              : true,
        };
      }

      // NA explicitly entered by teacher → not attempted, 0 marks
      if (typeof override === "string") {
        const trimmed = override.trim().toUpperCase();
        if (trimmed === "NA") {
          return {
            marks: 0,
            isAttempted: false,
          };
        }

        const numeric = Number(trimmed);
        if (Number.isNaN(numeric)) {
          return {
            marks: 0,
            isAttempted: true,
          };
        }

        // Teacher entered a number as string
        return {
          marks: numeric,
          // Any numeric entry (including 0) is attempted
          isAttempted: true,
        };
      }

      // Numeric override stored
      if (typeof override === "number") {
        return {
          marks: override,
          // Any number (including 0) is attempted
          isAttempted: true,
        };
      }

      return {
        marks: fallbackMarks,
        isAttempted: true,
      };
    };

    const buildQuestionPayload = (question: any) => {
      const baseQuestionId = question?.question_id;

      if (
        Array.isArray(question?.sub_questions) &&
        question.sub_questions.length > 0
      ) {
        const subQuestionsPayload = question.sub_questions.map((subQ: any) => {
          const subId = subQ?.question_id;
          const key = getQuestionMarkKey(subId, studentIdentifier);
          const existingMarks = Number(subQ?.marks);
          const fallbackMarks = Number.isNaN(existingMarks) ? 0 : existingMarks;

          const { marks, isAttempted } = getOverrideMarksAndAttempt(
            key,
            fallbackMarks,
            subQ?.is_attempted
          );

          return {
            question_id: subId,
            marks,
            isAttempted,
          };
        });

        // Aggregate parent details from children, respecting explicit attempt flags
        const parentMarks = subQuestionsPayload.reduce(
          (sum, sq) => sum + (Number(sq.marks) || 0),
          0
        );
        const parentAttempted = subQuestionsPayload.some((sq) => sq.isAttempted);

        return {
          question_id: baseQuestionId,
          marks: parentMarks,
          sub_questions: subQuestionsPayload,
          isAttempted: parentAttempted,
        };
      }

      const questionKey = getQuestionMarkKey(baseQuestionId, studentIdentifier);

      const existing = Number(question?.marks);
      const fallbackMarks = Number.isNaN(existing) ? 0 : existing;

      const { marks, isAttempted } = getOverrideMarksAndAttempt(
        questionKey,
        fallbackMarks,
        question?.is_attempted
      );

      return {
        question_id: baseQuestionId,
        marks,
        isAttempted,
      };
    };

    let updatedQuestionData: any[] = [];
    let hasValidationError = false;

    if (Array.isArray(sectionTree) && sectionTree.length > 0) {
      // Prefer section-aware validation whenever section tree is available
      for (const section of sectionTree) {
        const attemptableCount = Number(section?.attemptable_questions);
        const sectionQuestions = section?.questions || [];
        const sectionPayloads = sectionQuestions.map((q: any) =>
          buildQuestionPayload(q)
        );

        const attemptedQuestionsCount = sectionPayloads.filter(
          (q) => q.isAttempted
        ).length;

        if (attemptableCount && attemptedQuestionsCount > attemptableCount) {
          const sectionName = section?.section || "this section";
          toast.error(
            `Section ${sectionName}: Only ${attemptableCount} question(s) can be attempted out of ${sectionQuestions.length}. ` +
            `You have attempted ${attemptedQuestionsCount} questions.`
          );
          hasValidationError = true;
          break;
        }

        updatedQuestionData.push(...sectionPayloads);
      }
    } else if (
      Array.isArray(activeQuestionPaper?.questions) &&
      activeQuestionPaper?.questions?.length > 0
    ) {
      // Fallback for legacy flat structure (no sections)
      updatedQuestionData = activeQuestionPaper.questions.map((q) =>
        buildQuestionPayload(q)
      );
    }

    if (hasValidationError) {
      return;
    }

    // Transform isAttempted to is_attempted for API payload while keeping marks for validation
    updatedQuestionData = updatedQuestionData.map((q) => {
      const { isAttempted, sub_questions, ...rest } = q;

      const transformedSubQuestions = Array.isArray(sub_questions)
        ? sub_questions.map((sq: any) => {
          const { isAttempted: subIsAttempted, ...subRest } = sq;
          return {
            ...subRest,
            is_attempted: Boolean(subIsAttempted),
          };
        })
        : undefined;

      return {
        ...rest,
        sub_questions: transformedSubQuestions,
        is_attempted: Boolean(isAttempted),
      };
    });

    const questionMarksMap = new Map<number, number>(
      updatedQuestionData.map((entry) => [
        Number(entry?.question_id),
        Number(entry?.marks) || 0,
      ])
    );

    // Extra safety: re-validate attemptable per section using marks map
    if (Array.isArray(sectionTree) && sectionTree.length > 0) {
      const getSectionQuestionIds = (section: any): number[] => {
        const idsFromQuestions = Array.isArray(section?.questions)
          ? section.questions
            .map((q: any) => Number(q?.question_id))
            .filter((id: number) => !Number.isNaN(id))
          : [];

        const collectFromItems = (items: any[]): number[] => {
          if (!Array.isArray(items)) return [];
          const acc: number[] = [];
          items.forEach((node: any) => {
            if (!node) return;
            const maybeId = Number(node?.questionId ?? node?.question_id);
            if (!Number.isNaN(maybeId)) {
              acc.push(maybeId);
            }
            if (Array.isArray(node?.items)) {
              acc.push(...collectFromItems(node.items));
            }
          });
          return acc;
        };

        const idsFromItems = collectFromItems(section?.items ?? []);
        return Array.from(new Set([...idsFromQuestions, ...idsFromItems]));
      };

      for (const section of sectionTree) {
        const attemptableCount = Number(section?.attemptable_questions);
        const questionIds = getSectionQuestionIds(section);
        if (!attemptableCount || questionIds.length === 0) {
          continue;
        }

        const attemptedCount = questionIds.reduce((count, qId) => {
          const val = questionMarksMap.get(qId) ?? 0;
          return val > 0 ? count + 1 : count;
        }, 0);

        if (attemptedCount > attemptableCount) {
          const sectionName = section?.section || "this section";
          toast.error(
            `Section ${sectionName}: Only ${attemptableCount} question(s) can be attempted out of ${questionIds.length}. ` +
            `You have attempted ${attemptedCount} questions.`
          );
          return;
        }
      }
    }

    const hasInvalidOrSelection = (() => {
      const traverseNodes = (nodes: any[]): boolean => {
        if (!Array.isArray(nodes) || nodes.length === 0) {
          return false;
        }

        for (const node of nodes) {
          if (!node) continue;

          if (
            node?.nodeType === "group" &&
            node?.groupType?.toUpperCase?.() === "OR"
          ) {
            const questionIds = Array.isArray(node?.question_id)
              ? node.question_id
                .map((id: any) => Number(id))
                .filter((id: number) => !Number.isNaN(id))
              : [];
            const pickCount = Number(node?.pickCount) || 1;

            const answeredCount = questionIds.reduce((count, questionId) => {
              const value = questionMarksMap.get(questionId) ?? 0;
              return value > 0 ? count + 1 : count;
            }, 0);

            if (answeredCount > pickCount) {
              toast.error(
                `Only ${pickCount} question(s) can be attempted in this OR group. You have attempted ${answeredCount}.`
              );
              return true;
            }

            if (Array.isArray(node?.items) && traverseNodes(node.items)) {
              return true;
            }
            continue;
          }

          if (Array.isArray(node?.items) && traverseNodes(node.items)) {
            return true;
          }
        }

        return false;
      };

      const allNodes = sectionTree.flatMap((section) => section?.items ?? []);
      return traverseNodes(allNodes);
    })();

    if (hasInvalidOrSelection) {
      return;
    }

    const updatedObtainedMarks = updatedQuestionData.reduce(
      (totalMarks, question) => totalMarks + (Number(question?.marks) || 0),
      0
    );

    if (!updatedObtainedMarks) {
      toast.error("Please enter marks before submitting.");
      return;
    }

    const updateData = {
      question_data: updatedQuestionData,
      obtained_marks: updatedObtainedMarks || 0,
      question_paper_id: activeQuestionPaper?.question_paper_id,
    };

    try {
      if (examId) {
        const resultAction = await dispatch(
          updateExamMarksAsync({ Id: scholarId, updateData })
        );
        const result = resultAction.payload;

        if (result && result?.success) {
          toast.success("Marks updated successfully");
          setUpdatedMarks({});
          dispatch(
            listExamMarksAsync({
              examId: parseInt(examId),
              page: currentPage + 1,
              pageSize: itemsPerPage,
            })
          );
        } else {
          const errorMsg = result?.message || "An error occurred";
          toast.error(errorMsg);
        }
      }
    } catch (error) {
      console.error(`Failed to update marks for scholarId: ${scholarId}`, error);
      toast.error(`Error: ${(error as Error).message}`);
    }
  };

  // Data Mapping //
  const mapDataToTempData = (data: any[]) => {
    return data?.map((item) => {
      const studentFirstName = item?.user?.f_name ?? "";
      const studentIdentifier = studentFirstName || item?.student_id || "student";
      const studentAttendanceStatus = item?.attendance_status || "present"
      const questionPapers =
        item?.question_paper?.map((questionPaper: any, paperIndex: number) => {
          const sectionData = Array.isArray(questionPaper?.allSectionData)
            ? questionPaper?.allSectionData
            : [
              {
                section:
                  questionPaper?.section ?? `Section ${paperIndex + 1}`,
                questions: questionPaper?.questions ?? [],
                items: questionPaper?.items ?? [],
              },
            ];
          return {
            questionPaperId:
              questionPaper?.question_paper_id ?? `paper-${paperIndex + 1}`,
            label: (questionPaper.tag) ? questionPaper.tag : `Question Paper ${paperIndex + 1}`,
            isAttempted: Boolean(questionPaper?.is_attempted),
            sections: sectionData?.map((section: any, sectionIndex: number) => ({
              id: `${questionPaper?.question_paper_id ?? paperIndex + 1
                }-${sectionIndex + 1}`,
              section: section?.section ?? `Section ${sectionIndex + 1}`,
              // Keep raw structure so we can show OR / composite questions
              rawItems: section?.items ?? [],
              rawQuestions: section?.questions ?? [],
              attemptable_questions: section?.attemptable_questions ?? 0,
              // Flat list used for simple questions and exports
              questions: (section?.questions ?? []).map(
                (question: any, questionIndex: number) => {
                  const questionKey = getQuestionMarkKey(
                    question?.question_id,
                    studentIdentifier
                  );
                  return {
                    id: questionKey,
                    questionKey,
                    questionId: question?.question_id,
                    questionNumber: `Question ${questionIndex + 1}`,
                    typeOfQuestion: question?.type,
                    chapterName: question?.chapter,
                    marks: question?.marks,
                    maxMarks: question?.max_marks,
                    isAttempted: question?.is_attempted,
                  };
                }
              ),
            })),
          };
        }) ?? [];

      return {
        id: item?.id,
        scholarId: item?.student_id,
        name: `${item?.user?.f_name} ${item?.user?.l_name}`,
        studentFirstName,
        studentKey: studentIdentifier,
        section: item?.user?.section?.title,
        obtainedMarks: item?.obtained_marks,
        totalMarks: item?.total_marks,
        questionPapers,
        studentAttendanceStatus,
      };
    });
  };

  const tempData = mapDataToTempData(examMarks);

  useEffect(() => {
    if (!tempData) {
      return;
    }

    setSelectedQuestionPaperIds((prev) => {
      const updated: Record<number, string> = { ...prev };
      let hasChanges = false;

      tempData.forEach((scholar) => {
        const attemptedPapers =
          scholar?.questionPapers?.filter(
            (p: any) => p?.isAttempted
          ) ?? [];
        const preferredPaper =
          attemptedPapers[0] ?? scholar?.questionPapers?.[0];
        const firstQuestionPaperId =
          preferredPaper?.questionPaperId?.toString() ?? "";

        if (!firstQuestionPaperId) {
          if (updated[scholar?.id]) {
            delete updated[scholar?.id];
            hasChanges = true;
          }
          return;
        }

        const currentSelection = updated[scholar?.id];
        const selectionExists = scholar?.questionPapers?.some(
          (paper) => paper?.questionPaperId?.toString() === currentSelection
        );

        if (!currentSelection || !selectionExists) {
          updated[scholar?.id] = firstQuestionPaperId;
          hasChanges = true;
        }
      });

      Object.keys(updated).forEach((key) => {
        const numericKey = Number(key);
        const scholarExists = tempData?.some(
          (scholar) => scholar?.id === numericKey
        );

        if (!scholarExists) {
          delete updated[numericKey];
          hasChanges = true;
        }
      });

      return hasChanges ? updated : prev;
    });
  }, [tempData]);

  // handle Marks input here //
  const handleInputChange = (
    questionKey: string,
    value: string,
    maxMarks?: number
  ) => {
    const raw = value?.toString() ?? "";
    const trimmed = raw.trim();

    // Allow clearing the field
    if (trimmed === "") {
      const next = { ...updatedMarks };
      delete next[questionKey];
      setUpdatedMarks(next);
      return;
    }

    // Special handling for NA (not attempted)
    if (trimmed.toUpperCase() === "NA") {
      setUpdatedMarks({ ...updatedMarks, [questionKey]: "NA" });
      return;
    }

    // Otherwise expect a numeric value with validation
    const numericMax = Number(maxMarks);
    const numericValue = Number(trimmed);

    // if (Number.isNaN(numericValue)) {
    //   toast.error("Please enter a valid number or NA");
    //   return;
    // }

    if (!Number.isNaN(numericMax) && numericMax >= 0 && numericValue > numericMax) {
      toast.error(`Marks cannot be more than ${numericMax}`);
      return;
    }

    if (numericValue < 0) {
      toast.error(`Marks cannot be less than 0`);
      return;
    }

    setUpdatedMarks({ ...updatedMarks, [questionKey]: numericValue });
  };

  const inputBoxStyle = {
    border: "1px solid #ccc",
    padding: "5px",
    borderRadius: "4px",
  };

  const renderQuestionDetails = (
    selectedQuestionPaper: any,
    scholar: any
  ): React.ReactNode => {
    if (!selectedQuestionPaper?.sections?.length) {
      return (
        <tr>
          <td colSpan={6} className="text-center">
            No question paper data available
          </td>
        </tr>
      );
    }

    let serialNumber = 0;
    const studentIdentifier =
      scholar?.studentKey ?? scholar?.studentFirstName ?? scholar?.scholarId ?? "";

    const renderSimpleQuestionRow = (
      sectionId: string,
      question: any,
      keySuffix = "",
      skipSerialNumber = false
    ) => {
      // Only increment serial number if we're going to display it
      if (!skipSerialNumber) {
        serialNumber += 1;
      }
      const questionKey =
        question?.questionKey ??
        question?.id ??
        getQuestionMarkKey(
          question?.questionId ?? question?.question_id,
          studentIdentifier
        );
      const maxMarks =
        Number(question?.maxMarks ?? question?.marks ?? 0) || 0;
      const defaultValue = hasCustomMarkValue(updatedMarks, questionKey)
        ? updatedMarks[questionKey]
        : getExistingMarksFromNode(question);

      const isAttempted =
        typeof question?.isAttempted === "boolean"
          ? question.isAttempted
          : typeof question?.is_attempted === "boolean"
            ? question.is_attempted
            : undefined;

      let displayDefault: string | number = "";
      if (defaultValue !== undefined) {
        displayDefault = defaultValue;
      }
      if (isAttempted === false) {
        // Show NA for not attempted questions coming from API
        displayDefault = "NA";
      }

      // For skipSerialNumber, remove the question number prefix and show just the text
      let questionDisplayNumber = question?.questionNumber ?? `Question ${serialNumber}`;
      if (skipSerialNumber) {
        // Remove prefixes like "Q1:", "Q2:", "Question 1:", "Question 2:", etc. if present
        questionDisplayNumber = questionDisplayNumber.replace(/^(Q|Question)\s*\d+:\s*/i, "").trim();
        // If the result is empty, use the original question number
        if (!questionDisplayNumber) {
          questionDisplayNumber = question?.questionNumber ?? "";
        }
      }

      return (
        <tr key={`${sectionId}-question-${questionKey}${keySuffix}`}>
          <td>{skipSerialNumber ? "" : serialNumber}</td>
          <td>{questionDisplayNumber}</td>
          <td>{question?.typeOfQuestion ?? question?.type ?? "-"}</td>
          <td>{question?.chapterName ?? "-"}</td>
          <td>
            {hasUpdatePermission && (
              <input
                style={inputBoxStyle}
                type="text"
                id={`marks_${questionKey}`}
                defaultValue={displayDefault}
                onChange={(e) =>
                  handleInputChange(questionKey, e.target.value, maxMarks)
                }
                className="no-arrows"
              />
            )}
          </td>
          <td>{maxMarks}</td>
        </tr>
      );
    };

    const renderNodes = (
      sectionId: string,
      questionMap: Map<number, any>,
      nodes: any[],
      skipSerialNumber = false
    ): JSX.Element[] => {
      const rows: JSX.Element[] = [];

      nodes?.forEach((node, nodeIndex) => {
        if (!node) {
          return;
        }

        if (node?.nodeType === "group") {
          rows.push(
            <tr
              key={`group-${sectionId}-${nodeIndex}-${node?.questionId || node?.displayLabel || "group"
                }`}
            >
              <td colSpan={6} className="section-separator">
                <strong>
                  {node?.displayLabel ||
                    (node?.groupType === "OR" ? "Answer any one" : "Group")}
                </strong>
              </td>
            </tr>
          );

          node?.items?.forEach((child: any, childIndex: number) => {
            if (node?.groupType === "OR" && childIndex > 0) {
              rows.push(
                <tr
                  key={`group-or-${sectionId}-${nodeIndex}-${childIndex}`}
                >
                  <td
                    colSpan={6}
                    style={{ textAlign: "center", fontWeight: "bold" }}
                  >
                    OR
                  </td>
                </tr>
              );
            }

            // For OR groups, skip serial number for children after the first one
            const shouldSkipSerial = node?.groupType === "OR" && childIndex > 0;
            rows.push(
              ...renderNodes(sectionId, questionMap, [child], shouldSkipSerial)
            );
          });

          return;
        }

        if (node?.nodeType === "composite") {
          const parentQuestion = questionMap.get(Number(node?.questionId));

          if (parentQuestion) {
            // Only increment serial number if we're going to display it
            if (!skipSerialNumber) {
              serialNumber += 1;
            }
            const compositeTotal = calculateCompositeTotalFromChildren(
              node,
              studentIdentifier,
              Number(parentQuestion?.marks) || 0,
              updatedMarks
            );

            // For skipSerialNumber, remove the question number prefix from composite question
            let compositeQuestionNumber = parentQuestion?.questionNumber ?? "";
            if (skipSerialNumber) {
              compositeQuestionNumber = compositeQuestionNumber.replace(/^(Q|Question)\s*\d+:\s*/i, "").trim();
              if (!compositeQuestionNumber) {
                compositeQuestionNumber = parentQuestion?.questionNumber ?? "";
              }
            }

            rows.push(
              <tr
                key={`composite-parent-${sectionId}-${node?.questionId}`}
              >
                <td>{skipSerialNumber ? "" : serialNumber}</td>
                <td>{compositeQuestionNumber}</td>
                <td>{parentQuestion?.typeOfQuestion}</td>
                <td>{parentQuestion?.chapterName}</td>
                <td>{compositeTotal}</td>
                <td>{parentQuestion?.maxMarks ?? node?.totalMarks ?? "-"}</td>
              </tr>
            );
          }

          node?.items?.forEach((child: any, childIndex: number) => {
            if (child?.nodeType === "question") {
              const childQuestionDetails = questionMap.get(
                Number(child?.questionId)
              );
              const childKey = getQuestionMarkKey(
                child?.questionId,
                studentIdentifier
              );
              const labelSource =
                childQuestionDetails?.questionNumber ??
                parentQuestion?.questionNumber ??
                `Question ${serialNumber}`;
              const childLabel = child?.label
                ? `${labelSource} (${child?.label})`
                : labelSource;
              const childDefaultValue = hasCustomMarkValue(
                updatedMarks,
                childKey
              )
                ? updatedMarks[childKey]
                : getExistingMarksFromNode(child);
              const childMaxMarks =
                Number(
                  child?.maxMarks ??
                  child?.marks ??
                  node?.totalMarks ??
                  parentQuestion?.maxMarks ??
                  0
                ) || 0;

              const childIsAttempted =
                typeof child?.is_attempted === "boolean"
                  ? child.is_attempted
                  : undefined;

              let childDisplayDefault: string | number = "";
              if (childDefaultValue !== undefined) {
                childDisplayDefault = childDefaultValue;
              }
              if (childIsAttempted === false) {
                // Show NA for not attempted sub-questions coming from API
                childDisplayDefault = "NA";
              }

              rows.push(
                <tr
                  key={`${sectionId}-composite-child-${node?.questionId}-${child?.questionId}-${childIndex}`}
                >
                  <td></td>
                  <td>{childLabel}</td>
                  <td>
                    {childQuestionDetails?.typeOfQuestion ??
                      parentQuestion?.typeOfQuestion ??
                      "-"}
                  </td>
                  <td>
                    {childQuestionDetails?.chapterName ??
                      parentQuestion?.chapterName ??
                      "-"}
                  </td>
                  <td>
                    {hasUpdatePermission && (
                      <input
                        style={inputBoxStyle}
                        type="text"
                        id={`marks_${childKey}`}
                        defaultValue={
                          childDisplayDefault
                        }
                        onChange={(e) =>
                          handleInputChange(childKey, e.target.value, childMaxMarks)
                        }
                        className="no-arrows"
                      />
                    )}
                  </td>
                  <td>{childMaxMarks}</td>
                </tr>
              );
            } else {
              rows.push(
                ...renderNodes(sectionId, questionMap, [child], skipSerialNumber)
              );
            }
          });

          return;
        }

        if (node?.nodeType === "question") {
          const questionDetail =
            questionMap.get(Number(node?.questionId)) || {
              questionId: node?.questionId,
              questionNumber: node?.label
                ? `${node?.label}`
                : undefined,
              typeOfQuestion: node?.type,
              chapterName: node?.chapter,
              maxMarks: node?.maxMarks ?? node?.marks,
              marks: node?.marks,
            };

          rows.push(
            renderSimpleQuestionRow(
              sectionId,
              questionDetail,
              `-${nodeIndex}`,
              skipSerialNumber
            )
          );
        }
      });

      return rows;
    };
    const allRows = selectedQuestionPaper?.sections?.flatMap(
      (section: any) => {
        const totalQuestions = Array.isArray(section?.questions)
          ? section.questions.length
          : 0;
        const sectionRows: JSX.Element[] = [
          <tr key={`section-${section?.id}`}>
            <td className="" colSpan={12}>
              <div className="mb-0 flex justify-around items-center">
                {/* SECTION NAME — BIG */}
                <span className="!text-4xl font-bold">
                  {section?.section}
                </span>

                {/* INFO BADGE */}
                <span className="text-sm bg-[#eaf2ef] !text-black px-3 py-1 rounded-full border border-blue-300">
                  {`Attempt only ${section?.attemptable_questions} questions out of ${totalQuestions} total questions`}
                </span>
              </div>
            </td>
          </tr>,
        ];

        const questionMap = new Map<number, any>(
          (section?.questions ?? []).map((question: any) => [
            Number(question?.questionId ?? question?.question_id),
            question,
          ])
        );

        const subQuestionMeta = new Map<
          number,
          { marks: number; maxMarks: number; isAttempted?: boolean }
        >();

        (section?.rawQuestions ?? []).forEach((q: any) => {
          if (Array.isArray(q?.sub_questions)) {
            q.sub_questions.forEach((sq: any) => {
              const id = Number(sq?.question_id);
              if (Number.isNaN(id)) return;
              const marks = Number(sq?.marks);
              const maxMarks =
                Number(sq?.max_marks ?? sq?.marks ?? 0) || 0;
              subQuestionMeta.set(id, {
                marks: Number.isNaN(marks) ? 0 : marks,
                maxMarks,
                isAttempted:
                  typeof sq?.is_attempted === "boolean"
                    ? sq.is_attempted
                    : undefined,
              });
            });
          }
        });

        const sectionRenderNodes = (
          secId: string,
          qMap: Map<number, any>,
          nodes: any[],
          skipSerialNumber = false
        ): JSX.Element[] => {
          const rows: JSX.Element[] = [];

          nodes?.forEach((node, nodeIndex) => {
            if (!node) {
              return;
            }

            if (node?.nodeType === "group") {
              rows.push(
                <tr
                  key={`group-${secId}-${nodeIndex}-${node?.questionId || node?.displayLabel || "group"
                    }`}
                >
                  {/* <td colSpan={6} className="section-separator">
                    <strong>
                      {node?.displayLabel ||
                        (node?.groupType === "OR"
                          ? "Answer any one"
                          : "Group")}
                    </strong>
                  </td> */}
                </tr>
              );

              node?.items?.forEach((child: any, childIndex: number) => {
                if (node?.groupType === "OR" && childIndex > 0) {
                  rows.push(
                    <tr
                      key={`group-or-${secId}-${nodeIndex}-${childIndex}`}
                    >
                      <td
                        colSpan={6}
                        style={{
                          textAlign: "center",
                          fontWeight: "bold",
                        }}
                      >
                        OR
                      </td>
                    </tr>
                  );
                }

                // For OR groups, skip serial number for children after the first one
                const shouldSkipSerial = node?.groupType === "OR" && childIndex > 0;
                rows.push(
                  ...sectionRenderNodes(secId, qMap, [child], shouldSkipSerial)
                );
              });

              return;
            }

            if (node?.nodeType === "composite") {
              const parentQuestion = qMap.get(Number(node?.questionId));

              if (parentQuestion) {
                // Only increment serial number if we're going to display it
                if (!skipSerialNumber) {
                  serialNumber += 1;
                }
                const compositeTotal = calculateCompositeTotalFromChildren(
                  node,
                  studentIdentifier,
                  Number(parentQuestion?.marks) || 0,
                  updatedMarks,
                  subQuestionMeta
                );

                // For skipSerialNumber, remove the question number prefix from composite question
                let compositeQuestionNumber = parentQuestion?.questionNumber ?? "";
                if (skipSerialNumber) {
                  compositeQuestionNumber = compositeQuestionNumber.replace(/^(Q|Question)\s*\d+:\s*/i, "").trim();
                  if (!compositeQuestionNumber) {
                    compositeQuestionNumber = parentQuestion?.questionNumber ?? "";
                  }
                }

                rows.push(
                  <tr
                    key={`composite-parent-${secId}-${node?.questionId}`}
                  >
                    <td>{skipSerialNumber ? "" : serialNumber}</td>
                    <td className="!text-xl">{compositeQuestionNumber}</td>
                    <td>{parentQuestion?.typeOfQuestion}</td>
                    <td>{parentQuestion?.chapterName}</td>
                    <td>{compositeTotal}</td>
                    <td>
                      {parentQuestion?.maxMarks ??
                        node?.totalMarks ??
                        "-"}
                    </td>
                  </tr>
                );
              }

              node?.items?.forEach((child: any, childIndex: number) => {
                if (child?.nodeType === "question") {
                  const childQuestionDetails = qMap.get(
                    Number(child?.questionId)
                  );
                  const childKey = getQuestionMarkKey(
                    child?.questionId,
                    studentIdentifier
                  );
                  const labelSource =
                    childQuestionDetails?.questionNumber ??
                    parentQuestion?.questionNumber ??
                    `Question ${serialNumber}`;
                  const childLabel = child?.label
                    ? `${labelSource} (${child?.label})`
                    : labelSource;

                  const meta = subQuestionMeta.get(
                    Number(child?.questionId)
                  );

                  const childDefaultValue = hasCustomMarkValue(
                    updatedMarks,
                    childKey
                  )
                    ? updatedMarks[childKey]
                    : meta?.marks ??
                    getExistingMarksFromNode(child);

                  const childMaxMarks =
                    (meta?.maxMarks ??
                      Number(
                        child?.maxMarks ??
                        child?.marks ??
                        node?.totalMarks ??
                        parentQuestion?.maxMarks ??
                        0
                      )) || 0;

                  const childIsAttempted =
                    typeof meta?.isAttempted === "boolean"
                      ? meta.isAttempted
                      : typeof child?.is_attempted === "boolean"
                        ? child.is_attempted
                        : undefined;

                  let childDisplayDefault: string | number = "";
                  if (childDefaultValue !== undefined) {
                    childDisplayDefault = childDefaultValue;
                  }
                  if (childIsAttempted === false) {
                    childDisplayDefault = "NA";
                  }

                  rows.push(
                    <tr
                      key={`${secId}-composite-child-${node?.questionId}-${child?.questionId}-${childIndex}`}
                    >
                      <td></td>
                      <td>{childLabel}</td>
                      <td>
                        {childQuestionDetails?.typeOfQuestion ??
                          parentQuestion?.typeOfQuestion ??
                          "-"}
                      </td>
                      <td>
                        {childQuestionDetails?.chapterName ??
                          parentQuestion?.chapterName ??
                          "-"}
                      </td>
                      <td>
                        {hasUpdatePermission && (
                          <input
                            style={inputBoxStyle}
                            type="text"
                            id={`marks_${childKey}`}
                            defaultValue={
                              childDisplayDefault
                            }
                            onChange={(e) =>
                              handleInputChange(childKey, e.target.value, childMaxMarks)
                            }
                            className="no-arrows"
                          />
                        )}
                      </td>
                      <td>{childMaxMarks}</td>
                    </tr>
                  );
                } else {
                  rows.push(
                    ...sectionRenderNodes(secId, qMap, [child], skipSerialNumber)
                  );
                }
              });

              return;
            }

            if (node?.nodeType === "question") {
              const questionDetail =
                qMap.get(Number(node?.questionId)) || {
                  questionId: node?.questionId,
                  questionNumber: node?.label
                    ? `${node?.label}`
                    : undefined,
                  typeOfQuestion: node?.type,
                  chapterName: node?.chapter,
                  maxMarks: node?.maxMarks ?? node?.marks,
                  marks: node?.marks,
                };

              const childMeta = subQuestionMeta.get(
                Number(node?.questionId)
              );
              if (childMeta) {
                questionDetail.marks = childMeta.marks;
                questionDetail.maxMarks = childMeta.maxMarks;
              }

              rows.push(
                renderSimpleQuestionRow(
                  secId,
                  questionDetail,
                  `-${nodeIndex}`,
                  skipSerialNumber
                )
              );
            }
          });

          return rows;
        };

        if (Array.isArray(section?.rawItems) && section?.rawItems?.length > 0) {
          sectionRows.push(
            ...sectionRenderNodes(
              section?.id,
              questionMap,
              section?.rawItems
            )
          );
        } else {
          section?.questions?.forEach((question: any) => {
            sectionRows.push(
              renderSimpleQuestionRow(section?.id, question)
            );
          });
        }

        return sectionRows;
      }
    );

    if (!allRows?.length) {
      return (
        <tr>
          <td colSpan={6} className="text-center">
            No question paper data available
          </td>
        </tr>
      );
    }

    return allRows;
  };

  // Pagination logic here //
  const handlePageClick = (data: { selected: number }) => {
    setCurrentPage(data.selected);
    setLoading(true);

    if (examId) {
      const payload: any = {
        examId: parseInt(examId),
        page: data.selected + 1,
        pageSize: itemsPerPage,
        searchQuery,
      };

      if (sectionSelected.length > 0) {
        payload.sectionId = sectionSelected;
      }

      if (sortConfig?.key) {
        payload.sort = {
          field: sortConfig.key,
          order: sortConfig.direction,
        };
      }

      dispatch(listExamMarksAsync(payload)).then((result) => {
        if (result?.payload?.count !== undefined) {
          setTotalExamCount(result.payload.count);
        }
        setLoading(false);
      });
    }
  };

  // Excel download logic here //
  const handleDownload = async () => {
    if (!examId) {
      toastError("Exam ID is missing.");
      return;
    }

    try {
      const sortPayload =
        sortConfig && sortConfig.key
          ? {
            sort: {
              field: sortConfig.key,
              order: sortConfig.direction,
            },
          }
          : {};

      // Fetch all data before exporting with current sort config
      const result = await dispatch(
        listExamMarksAsync({
          examId: Number(examId),
          isAllDataFetch: true,
          searchQuery,
          sectionId: sectionSelected.length > 0 ? sectionSelected : [],
          ...sortPayload,
        })
      ).unwrap();

      const examMarks = result.examMarks;

      if (!examMarks || examMarks.length === 0) {
        toastError("No exam data available to download.");
        return;
      }
      // Generate Excel // 
      generateExcelFile(examMarks);

      // Optionally, reset to paginated view with sorting applied
      await dispatch(
        listExamMarksAsync({
          examId: Number(examId),
          page: currentPage + 1,
          pageSize: itemsPerPage,
          ...sortPayload,
        })
      );
    } catch (error) {
      toastError("Failed to download exam marks.");
    }
  };


  // Updated generateExcelFile function - Only shows N/A in data rows, keeps original calculations
  // Replace your existing generateExcelFile function (around line 1674) with this code

  const generateExcelFile = (examMarks) => {
    console.log("Generating Excel with separate blocks per Set");

    if (!examMarks || examMarks.length === 0) return;

    const getAttemptedTag = (scholar) => {
      const attemptedPaper = scholar?.question_paper?.find(
        (paper) => paper?.is_attempted === true
      );
      return attemptedPaper?.tag || "";
    };

    const buildBlockForSet = (setExamMarks, setTag: string) => {
      if (!setExamMarks || setExamMarks.length === 0) return [];

      const firstScholar = setExamMarks[0];

      // Extract class, sections, and exam name
      const className = firstScholar?.user?.grade?.title || "N/A";
      const examName = firstScholar?.exam?.name || "N/A";

      // Get unique sections from all students of this set
      const uniqueSections = [
        ...new Set(
          setExamMarks.map((scholar) => scholar?.user?.section?.title)
        ),
      ]
        .filter(Boolean)
        .sort();
      const sectionsString = uniqueSections.join(", ");

      // Info row specific to this set
      const infoRow = [
        `${className}_Section-${sectionsString}_${examName}_Set-${setTag}`,
      ];

      const headers = [
        ["Index", "Section", "Scholar ID", "Name of Student", "Tag"],
      ];
      const maxMarksRow = ["", "", "", "", ""];
      const questionNumbers = ["", "", "", "", ""];
      const chapterNames = ["", "", "", "", ""];
      const questionTypes = ["", "", "", "", ""];

      let colIndex = 5;
      let globalQuestionNumber = 1;
      const questionIdToSequentialNumber = new Map<number, number>();

      // Use the question paper of this set (prefer tag match)
      const questionPaperSet =
        firstScholar?.question_paper?.find((paper) => paper?.tag === setTag) ||
        firstScholar?.question_paper?.find((paper) => paper?.is_attempted) ||
        firstScholar?.question_paper?.[0];

      if (questionPaperSet?.allSectionData) {
        const processItems = (items) => {
          if (!items) return;

          items.forEach((item) => {
            if (item.nodeType === "group" && item.groupType === "OR") {
              const orGroupNumber = globalQuestionNumber;

              if (item.question_id && Array.isArray(item.question_id)) {
                item.question_id.forEach((qId) => {
                  if (!questionIdToSequentialNumber.has(qId)) {
                    questionIdToSequentialNumber.set(qId, orGroupNumber);
                  }
                });
              }

              globalQuestionNumber++;
            } else if (item.nodeType === "question") {
              if (!questionIdToSequentialNumber.has(item.questionId)) {
                questionIdToSequentialNumber.set(
                  item.questionId,
                  globalQuestionNumber++
                );
              }
            } else if (item.nodeType === "composite") {
              const compositeNumber = globalQuestionNumber;

              if (!questionIdToSequentialNumber.has(item.questionId)) {
                questionIdToSequentialNumber.set(
                  item.questionId,
                  compositeNumber
                );
              }

              if (item.question_id && Array.isArray(item.question_id)) {
                item.question_id.forEach((qId) => {
                  if (!questionIdToSequentialNumber.has(qId)) {
                    questionIdToSequentialNumber.set(qId, compositeNumber);
                  }
                });
              }

              globalQuestionNumber++;
            } else if (item.items) {
              processItems(item.items);
            }
          });
        };

        questionPaperSet.allSectionData.forEach((sectionData) => {
          if (!sectionData?.questions || sectionData.questions.length === 0) {
            return;
          }
          processItems(sectionData.items);
        });

        // Second pass: build headers with sequential question numbers
        questionPaperSet.allSectionData.forEach((sectionData) => {
          if (!sectionData?.questions || sectionData.questions.length === 0) {
            return;
          }

          const questionCount = sectionData.questions.length;
          const sectionLabel = `Section - ${sectionData.section}`;

          headers[0].push(sectionLabel);
          if (questionCount > 1) {
            headers[0].push(...Array(questionCount - 1).fill(""));
          }

          sectionData.questions.forEach((q) => {
            const seqNum = questionIdToSequentialNumber.get(q.question_id);
            questionNumbers.push(`Q${seqNum || "?"}`);
            chapterNames.push(q.chapter || "");
            questionTypes.push(q.type || "");
            maxMarksRow.push(q.max_marks || "");
          });

          colIndex += questionCount;
        });
      }

      // Add Total columns
      headers[0].push("Total Obtained Marks", "Total Marks");
      questionNumbers.push("", "");
      chapterNames.push("", "");
      questionTypes.push("", "");
      maxMarksRow.push("", "");

      const finalHeaders = [infoRow];
      finalHeaders.push(headers[0]);
      finalHeaders.push(questionNumbers);
      finalHeaders.push(chapterNames);
      finalHeaders.push(questionTypes);
      finalHeaders.push(maxMarksRow);

      // ============ UPDATED: Data rows - Only change here is showing N/A for not attempted ============
      const dataRows = setExamMarks.map((scholar, index) => {
        const attemptedPaperForSet =
          scholar?.question_paper?.find(
            (paper) => paper?.tag === setTag && paper?.is_attempted === true
          ) ||
          scholar?.question_paper?.find((paper) => paper?.tag === setTag);

        const tagName = attemptedPaperForSet?.tag || setTag || "Not Attempted";

        const base = [
          index + 1,
          scholar?.user?.section?.title || "",
          scholar?.student_id || "",
          `${scholar?.user?.f_name || ""} ${scholar?.user?.l_name || ""}`,
          tagName,
        ];

        // Process each question - show N/A for not attempted, otherwise show marks (including 0)
        attemptedPaperForSet?.allSectionData?.forEach((sectionData) => {
          sectionData?.questions?.forEach((q) => {
            // ONLY CHANGE: Check if question was explicitly marked as not attempted
            if (q?.is_attempted === false) {
              base.push("N/A");  // Show N/A for not attempted questions
            } else {
              // Show marks - could be 0 if attempted but got 0 marks, or any other value
              base.push(q?.marks ?? "");
            }
          });
        });

        base.push(scholar?.obtained_marks ?? "");
        base.push(scholar?.total_marks ?? "");

        return base;
      });

      const emptyRow1 = new Array(dataRows[0]?.length || 0).fill("");
      const studentCountRow = [
        "",
        "",
        "",
        "Number of Student",
        setExamMarks.length,
      ];

      // ============ ORIGINAL CALCULATION: Exactly as before, treating N/A as 0 ============
      const questionSumsRow = ["", "", "", "", ""];
      if (dataRows[0]) {
        for (let colIdx = 5; colIdx < dataRows[0].length - 2; colIdx++) {
          let totalPercentage = 0;
          let studentCount = 0;

          const maxMarks = parseFloat(
            maxMarksRow[colIdx]?.toString() || "0"
          );

          if (maxMarks > 0) {
            dataRows.forEach((row) => {
              const cellValue = row[colIdx];
              // Treat N/A as "0" for calculation purposes (original behavior)
              const obtainedMarks = parseFloat(
                cellValue === "N/A" ? "0" : (cellValue?.toString() || "0")
              );
              if (!isNaN(obtainedMarks)) {
                const percentage = (obtainedMarks / maxMarks) * 100;
                totalPercentage += percentage;
                studentCount++;
              }
            });

            const totalPossiblePercentage = studentCount * 100;
            const tempCalculatedResult = Number(
              (totalPercentage / totalPossiblePercentage) * 100
            );
            questionSumsRow.push(`${tempCalculatedResult.toFixed(2)} %`);
          } else {
            questionSumsRow.push("0.00 %");
          }
        }
      }

      let totalObtainedSum = 0;
      setExamMarks.forEach((scholar) => {
        totalObtainedSum += parseFloat(
          scholar?.obtained_marks?.toString() || "0"
        );
      });
      questionSumsRow.push(totalObtainedSum.toFixed(2));
      questionSumsRow.push("");

      const blockData: any[] = [
        ...finalHeaders,
        ...dataRows,
        emptyRow1,
        studentCountRow,
        questionSumsRow,
      ];

      // ========== ORIGINAL: Section-wise performance (unchanged) ==========
      if (questionPaperSet?.allSectionData && dataRows[0]) {
        const sectionPerformanceData: any[] = [];

        // Header row with question numbers
        const sectionPerfHeader = ["", ""];
        questionPaperSet.allSectionData.forEach((sectionData) => {
          sectionData.questions.forEach((q) => {
            const seqNum = questionIdToSequentialNumber.get(q.question_id);
            sectionPerfHeader.push(`Q-${seqNum || "?"}`);
          });
        });
        sectionPerformanceData.push(sectionPerfHeader);

        // Unique class sections in this set
        const classSections = Array.from(
          new Set(
            setExamMarks
              .map((scholar) => scholar?.user?.section?.title as string | undefined)
              .filter((title): title is string => Boolean(title))
          )
        ).sort();

        classSections.forEach((classSection) => {
          const sectionRow = ["", `Section - ${classSection}`];

          const sectionStudents = setExamMarks.filter(
            (scholar) => scholar?.user?.section?.title === classSection
          );

          questionPaperSet.allSectionData.forEach((sectionData) => {
            sectionData.questions.forEach((question, qIdx) => {
              let totalPercentage = 0;
              const studentCount = sectionStudents.length;
              const maxMarks = parseFloat(
                question.max_marks?.toString() || "0"
              );

              if (maxMarks > 0 && studentCount > 0) {
                sectionStudents.forEach((scholar) => {
                  const scholarSet = scholar?.question_paper?.find(
                    (paper) => paper?.tag === setTag
                  );
                  const scholarSection = scholarSet?.allSectionData?.find(
                    (s) => s.section === sectionData.section
                  );

                  if (scholarSection?.questions?.[qIdx]) {
                    const obtainedMarks = parseFloat(
                      scholarSection.questions[qIdx].marks?.toString() || "0"
                    );
                    const percentage = (obtainedMarks / maxMarks) * 100;
                    totalPercentage += percentage;
                  }
                });

                const totalPossiblePercentage = studentCount * 100;
                const result =
                  (totalPercentage / totalPossiblePercentage) * 100;
                sectionRow.push(`${result.toFixed(2)} %`);
              } else {
                sectionRow.push("0.00 %");
              }
            });
          });

          sectionPerformanceData.push(sectionRow);
        });

        // Overall performance row for this set
        const overallRow = ["", "Overall Performance"];
        questionPaperSet.allSectionData.forEach((sectionData) => {
          sectionData.questions.forEach((question, qIdx) => {
            let totalPercentage = 0;
            const studentCount = setExamMarks.length;
            const maxMarks = parseFloat(
              question.max_marks?.toString() || "0"
            );

            if (maxMarks > 0 && studentCount > 0) {
              setExamMarks.forEach((scholar) => {
                const scholarSet = scholar?.question_paper?.find(
                  (paper) => paper?.tag === setTag
                );
                const scholarSection = scholarSet?.allSectionData?.find(
                  (s) => s.section === sectionData.section
                );

                if (scholarSection?.questions?.[qIdx]) {
                  const obtainedMarks = parseFloat(
                    scholarSection.questions[qIdx].marks?.toString() || "0"
                  );
                  const percentage = (obtainedMarks / maxMarks) * 100;
                  totalPercentage += percentage;
                }
              });

              const totalPossiblePercentage = studentCount * 100;
              const result =
                (totalPercentage / totalPossiblePercentage) * 100;
              overallRow.push(`${result.toFixed(2)} %`);
            } else {
              overallRow.push("0.00 %");
            }
          });
        });
        sectionPerformanceData.push(overallRow);

        // Add a blank row and then section-wise table to block
        blockData.push([]);
        blockData.push(...sectionPerformanceData);
      }

      // ========== ORIGINAL: Chapter-wise analysis (unchanged) ==========
      if (questionPaperSet?.allSectionData && dataRows[0]) {
        const chapterAnalysisData: any[] = [];

        const chapterMap = new Map<
          string,
          {
            questions: any[];
            sections: Set<string>;
          }
        >();

        questionPaperSet.allSectionData.forEach((sectionData) => {
          sectionData.questions.forEach((question) => {
            const chapter = question.chapter || "Unknown Chapter";
            if (!chapterMap.has(chapter)) {
              chapterMap.set(chapter, {
                questions: [],
                sections: new Set(),
              });
            }
            const chapterData = chapterMap.get(chapter)!;
            chapterData.questions.push({
              ...question,
              section: sectionData.section,
              seqNum: questionIdToSequentialNumber.get(question.question_id),
            });
            chapterData.sections.add(sectionData.section);
          });
        });

        const classSections = Array.from(
          new Set(
            setExamMarks
              .map((scholar) => scholar?.user?.section?.title as string | undefined)
              .filter((title): title is string => Boolean(title))
          )
        ).sort();

        chapterMap.forEach((chapterData, chapterName) => {
          // Chapter header row
          const chapterHeaderRow = [`${chapterName}`, "", ""];

          chapterData.questions.forEach((q) => {
            chapterHeaderRow.push(`Q. ${q.seqNum || "?"}`);
          });

          chapterHeaderRow.push("Obtained", "Total", "%age");
          chapterAnalysisData.push(chapterHeaderRow);

          // Rows per class section
          classSections.forEach((classSection) => {
            const sectionRow = ["", "", `${classSection}`];

            const sectionStudents = setExamMarks.filter(
              (scholar) => scholar?.user?.section?.title === classSection
            );

            let sectionTotalObtained = 0;
            let sectionTotalMax = 0;

            chapterData.questions.forEach((chapterQuestion) => {
              let questionTotalObtained = 0;
              let questionTotalMax = 0;

              sectionStudents.forEach((scholar) => {
                const scholarSet = scholar?.question_paper?.find(
                  (paper) => paper?.tag === setTag
                );

                scholarSet?.allSectionData?.forEach((scholarSection) => {
                  const matchingQuestion = scholarSection.questions?.find(
                    (q) => q.question_id === chapterQuestion.question_id
                  );

                  if (matchingQuestion) {
                    const marks = parseFloat(
                      matchingQuestion.marks?.toString() || "0"
                    );
                    const maxMarks = parseFloat(
                      matchingQuestion.max_marks?.toString() || "0"
                    );

                    questionTotalObtained += marks;
                    questionTotalMax += maxMarks;
                  }
                });
              });

              const questionPercentage =
                questionTotalMax > 0
                  ? ((questionTotalObtained / questionTotalMax) * 100).toFixed(
                    2
                  )
                  : "0.00";

              sectionRow.push(`${questionPercentage}%`);

              sectionTotalObtained += questionTotalObtained;
              sectionTotalMax += questionTotalMax;
            });

            sectionRow.push(sectionTotalObtained.toFixed(2));
            sectionRow.push(sectionTotalMax.toFixed(0));

            const sectionPercentage =
              sectionTotalMax > 0
                ? ((sectionTotalObtained / sectionTotalMax) * 100).toFixed(2)
                : "0.00";
            sectionRow.push(`${sectionPercentage}%`);

            chapterAnalysisData.push(sectionRow);
          });

          // Blank row between chapters
          chapterAnalysisData.push([]);
        });

        // Add a blank row and chapter analysis to block
        blockData.push([]);
        blockData.push(...chapterAnalysisData);
      }

      // Add a couple of empty rows as separator between sets
      blockData.push([]);
      blockData.push([]);

      return blockData;
    };

    // ============ UPDATED: Remove default set logic, only use actual tags ============
    const tagOrder = ["SET A", "SET B"];
    const rawTags = examMarks
      .map((s) => getAttemptedTag(s) as string | undefined)
      .filter((tag): tag is string => Boolean(tag)); // Only include scholars with actual tags
    const allTags = Array.from(new Set<string>(rawTags));

    const orderedTags: string[] = [
      ...tagOrder.filter((t) => allTags.includes(t)),
      ...allTags.filter((t) => !tagOrder.includes(t)),
    ];

    const finalData: any[] = [];

    orderedTags.forEach((tag: string) => {
      const setExamMarks = examMarks.filter(
        (scholar) => getAttemptedTag(scholar) === tag
      );
      const block = buildBlockForSet(setExamMarks, tag);
      if (block && block.length > 0) {
        finalData.push(...block);
      }
    });

    const ws = XLSX.utils.aoa_to_sheet(finalData);
    ws["!cols"] = Array(finalData[0]?.length || 0).fill({ wch: 15 });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Exam Marks");

    const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([excelBuffer], { type: "application/octet-stream" });
    saveAs(blob, `Exam_Marks_${examId}.xlsx`);
  };

  const handleBack = () => {
    navigate("/school-admin/exam");
  };

  const handleAttendanceChange = (
    scholarId: number | null,
    attendanceName: string
  ) => {
    setSelectedScholarId(scholarId);
    setSelectedAttendance(attendanceName);
    setShow(true);
  };

  const onConfirmAttendance = async () => {
    if (selectedScholarId && selectedAttendance) {
      try {
        const payload = {
          examStudentMarkId: [selectedScholarId],
          attendanceStatus: selectedAttendance,
        };

        const resultAction = await dispatch(
          updateStudentAttendanceAsync({
            studentAttendanceDetails: payload,
          })
        );

        const result = resultAction.payload;
        const attendance = result?.data[0]?.attendance_status || "present";
        localStorage.setItem(`attendance_${selectedScholarId}`, attendance);

        if (result && result.success) {
          setUpdatedMarks((prev) => ({
            ...prev,
            [selectedScholarId]: attendance,
          }));

          // Refresh the exam marks list to get updated attendance status
          if (examId) {
            const payload: any = {
              examId: parseInt(examId),
              page: currentPage + 1,
              pageSize: itemsPerPage,
              searchQuery,
            };

            if (sectionSelected.length > 0) {
              payload.sectionId = sectionSelected;
            }

            if (sortConfig?.key) {
              payload.sort = {
                field: sortConfig.key,
                order: sortConfig.direction,
              };
            }

            dispatch(listExamMarksAsync(payload)).then((result) => {
              if (result?.payload?.count !== undefined) {
                setTotalExamCount(result.payload.count);
              }
            });
          }

          toast.success("Attendance updated successfully");
        } else {
          console.error("Failed to update attendance");
          toast.error("Failed to update attendance");
        }
      } catch (error) {
        toast.error(`Error: ${(error as Error).message}`);
      } finally {
        setShow(false);
      }
    }
  };

  useEffect(() => {
    examMarks?.forEach((scholar) => {
      const storedAttendance = localStorage.getItem(
        `attendance_${scholar?.id}`
      );
      setUpdatedMarks((prev) => ({
        ...prev,
        [scholar?.id]: storedAttendance || "present",
      }));
    });
  }, [examMarks]);

  // Tsx here //
  return (
    <>
      <div className="container">
        <div className="inner-section d-flex gap-1 flex-wrap justify-content-between">
          <div className="left-area">
            <h6>Add Marks</h6>
          </div>
          <div className="right-area">
            <button
              className="custom-inactive-button rounded-lg exam-cancel-button"
              onClick={handleBack}
            >
              Back
            </button>
            <button
              className="custom-active-button rounded-lg"
              onClick={handleDownload}
            >
              Download
            </button>
          </div>
        </div>
      </div>

      {/* Action area */}
      <div className="container">
        <div className="action-area">
          <div className="search-div">
            <span className="search-icon">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#a5a5a5"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-search"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </span>
            <input
              type="text"
              placeholder="Search by Student Name or Scholar Id"
              value={searchQuery}
              onChange={handleSearch}
              className="form-control"
            />
          </div>
          <div className="actions-buttons d-flex align-items-center">
            <span className="ms-2">
              {totalExamCount > 0
                ? `${totalExamCount} records found`
                : "0 records found"}
            </span>
            <span onClick={handleShowFilterModal} className="tooltip-relative">
              <img src={newFilterIcon} alt="Filter Icon" />
              <span className="tooltip">Filter</span>
            </span>
          </div>
        </div>
      </div>

      {/* Table data showing here  */}
      <div className="container">
        {isLoading ? (
          <div className="loader d-flex justify-content-center align-items-center">
            <Spinner animation="border" />
          </div>
        ) : (
          <div className="responsive-table">
            <Table responsive>
              <thead>
                <tr>
                  <th>Sr.No</th>
                  <th className="cursor-pointer"
                    onClick={() => handleSort("student_id")}>Scholar ID
                    {sortConfig.key === "student_id" ? (sortConfig.direction === "ASC" ? "▲" : "▼") : "▲"}</th>
                  <th>Name</th>
                  <th className="cursor-pointer"
                    onClick={() => handleSort("section_id")}>Section
                    {sortConfig.key === "section_id" ? (sortConfig.direction === "ASC" ? "▲" : "▼") : "▲"}</th>
                  <th>Obtained Marks</th>
                  <th>Total Marks</th>
                  <th>Question Paper List</th>
                  <th>Student Attendance</th>
                </tr>
              </thead>
              <tbody>
                {tempData?.length > 0 ? (
                  tempData?.map((scholar, index) => {
                    const questionPapers = scholar?.questionPapers ?? [];
                    const hasAnyAttempted = questionPapers.some(
                      (paper: any) => paper?.isAttempted
                    );
                    const defaultQuestionPaperId =
                      questionPapers?.[0]?.questionPaperId?.toString() ?? "";
                    const selectedQuestionPaperId =
                      selectedQuestionPaperIds[scholar?.id] ??
                      defaultQuestionPaperId;
                    const selectedQuestionPaper = questionPapers?.find(
                      (paper) =>
                        paper?.questionPaperId?.toString() ===
                        selectedQuestionPaperId
                    );
                    return (
                      <React.Fragment key={scholar.id}>
                        <tr className="header-level">
                          <td>
                            <div className="flex gap-2">
                              <td>{index + 1 + currentPage * itemsPerPage}</td>
                              <span>
                                <button
                                  style={{ border: "none" }}
                                  title=""
                                  className="expand"
                                  onClick={() =>
                                    toggleShowQuestionsForScholar(
                                      scholar?.scholarId
                                    )
                                  }
                                >
                                  <img
                                    src={
                                      showQuestionsScholarId ===
                                        scholar?.scholarId
                                        ? uparrowIcon
                                        : downarrowIcon
                                    }
                                    className="cursor-pointer"
                                    alt="Toggle Questions"
                                  />
                                </button>
                              </span>
                            </div>
                          </td>
                          <td>{scholar?.scholarId}</td>
                          <td>{scholar?.name}</td>
                          <td>{scholar?.section}</td>
                          <td>{scholar?.obtainedMarks}</td>
                          <td>{scholar?.totalMarks}</td>
                          <td>
                            <select
                              className="selection-dropdown cursor-pointer"
                              value={selectedQuestionPaperId}
                              onChange={(e) =>
                                handleQuestionPaperChange(
                                  scholar?.id,
                                  e.target.value
                                )
                              }
                              disabled={!questionPapers?.length}
                            >
                              {questionPapers?.length > 0 ? (
                                questionPapers?.map((paper: any) => {
                                  const value =
                                    paper?.questionPaperId?.toString() ?? "";
                                  const isAttempted = Boolean(
                                    paper?.isAttempted
                                  );
                                  const isDisabled =
                                    hasAnyAttempted && !isAttempted;

                                  return (
                                    <option
                                      key={paper?.questionPaperId}
                                      value={value}
                                      className="cursor-pointer"
                                      disabled={isDisabled}
                                    >
                                      {paper?.label ?? paper?.questionPaperId}
                                      {isAttempted ? " (Attempted)" : ""}
                                    </option>
                                  );
                                })
                              ) : (
                                <option value="">No Question Papers</option>
                              )}
                            </select>
                          </td>
                          <td>
                            <select
                              className="selection-dropdown cursor-pointer"
                              value={updatedMarks[scholar?.id] || "present"}
                              onChange={(e) => {
                                const selectedAttendance = Attendance.find(
                                  (item) => item?.name === e.target.value
                                );
                                if (selectedAttendance) {
                                  handleAttendanceChange(
                                    scholar?.id,
                                    selectedAttendance?.name
                                  );
                                }
                              }}
                            >
                              {Attendance?.map((item) => (
                                <option
                                  key={item.id}
                                  value={item?.name}
                                  className="cursor-pointer"
                                >
                                  {item?.name.toLocaleUpperCase()}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                        {(() => {
                          // Use updated attendance from state if available, otherwise use the one from data
                          const currentAttendance = updatedMarks[scholar?.id] || scholar?.studentAttendanceStatus || "present";

                          if (currentAttendance !== "present") {
                            return showQuestionsScholarId === scholar?.scholarId ? (
                              <tr className="sub-level">
                                <td colSpan={12} style={{ padding: 0 }}>
                                  <Table responsive>
                                    <thead>
                                      <tr>
                                        <th className="text-center">{currentAttendance.toLowerCase()}</th>
                                      </tr>
                                    </thead>
                                  </Table>
                                </td>
                              </tr>
                            ) : "";
                          }

                          return showQuestionsScholarId === scholar?.scholarId ? (
                            <tr className="sub-level">
                              <td colSpan={12} style={{ padding: 0 }}>
                                <Table responsive>
                                  <thead>
                                    <tr>
                                      <th>S.No.</th>
                                      <th>Question No.</th>
                                      <th>Type of Question</th>
                                      <th>Chapter Name</th>
                                      <th>Marks</th>
                                      <th>Max Marks</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {renderQuestionDetails(
                                      selectedQuestionPaper,
                                      scholar
                                    )}
                                    {hasUpdatePermission &&
                                      selectedQuestionPaper?.sections?.length ? (
                                      <tr>
                                        <td
                                          colSpan={6}
                                          style={{ textAlign: "center" }}
                                        >
                                          <button
                                            className="custom-active-button rounded-lg"
                                            onClick={() =>
                                              handleUpdateMarks(scholar?.id)
                                            }
                                          >
                                            Submit
                                          </button>
                                        </td>
                                      </tr>
                                    ) : null}
                                  </tbody>
                                </Table>
                              </td>
                            </tr>
                          ) : "";
                        })()}

                      </React.Fragment>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={12} className="text-center">
                      No data found
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>

            {/*  Pagination here  */}
            <ReactPaginate
              previousLabel={"Previous"}
              nextLabel={"Next"}
              breakLabel={"..."}
              pageCount={Math.ceil(totalExamCount / itemsPerPage)}
              marginPagesDisplayed={2}
              pageRangeDisplayed={3}
              onPageChange={handlePageClick}
              containerClassName={"pagination"}
              activeClassName={"active"}
              forcePage={currentPage}
            />
          </div>
        )}
      </div>

      {/*Attendance confirmation modal here  */}
      <Modal
        show={show}
        onHide={onHide}
        backdrop="static"
        keyboard={false}
        centered
      >
        <Modal.Header closeButton></Modal.Header>
        <Modal.Body>
          <form className="horizontal-form">
            <div className="flex flex-wrap flex-col gap-4">
              <img
                src={circleQuestionIcon}
                className="block mx-auto"
                alt="questionIcon"
                width={80}
              />
              <h5 className="m-0 text-center">
                Are you sure you want to change student attendance?
              </h5>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="w-full custom-inactive-button rounded-lg"
                  onClick={onConfirmAttendance}
                >
                  Yes
                </button>
                <button
                  type="button"
                  className="w-full custom-active-button rounded-lg"
                  onClick={onHide}
                >
                  No
                </button>
              </div>
            </div>
          </form>
        </Modal.Body>
      </Modal>

      {/* Filter modal here  */}
      <Modal
        show={showFilterModal}
        onHide={handleCloseFilterModal}
        backdrop="static"
        keyboard={false}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title className="h5">Filters</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <form className="horizontal-form">
            <div className="row">
              <div className="col-md-6">
                <div className="form-group mb-4">
                  <label htmlFor="">Section</label>
                  <Listbox
                    multiple
                    value={sectionSelected}
                    onChange={(selected) => {
                      setSectionSelected(selected);
                    }}
                  >
                    <div className="relative">
                      <Listbox.Button className="relative w-full text-left">
                        <span className="block truncate">
                          {sectionSelected?.length > 0
                            ? sectionsDataList
                              .filter((sectionItem) =>
                                sectionSelected.includes(sectionItem?.id)
                              )
                              .map((sel) => sel?.title)
                              .join(", ")
                            : "Select section"}
                        </span>
                        <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                          <ChevronUpDownIcon
                            className="h-5 w-5 text-gray-400"
                            aria-hidden="true"
                          />
                        </span>
                      </Listbox.Button>
                      <Transition
                        as={Fragment}
                        leave="transition ease-in duration-100"
                        leaveFrom="opacity-100"
                        leaveTo="opacity-0"
                      >
                        <Listbox.Options className="z-10 absolute mt-1 max-h-60 w-full overflow-auto rounded-md bg-white p-0 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm">
                          {sectionsDataList?.length > 0 ? (
                            sectionsDataList?.map((sectionItem) => (
                              <Listbox.Option
                                key={sectionItem.id}
                                value={sectionItem?.id}
                                className={({ active }) =>
                                  `relative cursor-pointer select-none py-2 pl-10 pr-4 ${active
                                    ? "bg-orange-100 text-orange-700"
                                    : "text-gray-900"
                                  }`
                                }
                              >
                                {({ selected }) => (
                                  <>
                                    <span
                                      className={`block truncate ${selected
                                        ? "font-medium"
                                        : "font-normal"
                                        }`}
                                    >
                                      {sectionItem?.title}
                                    </span>
                                    {selected && (
                                      <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                                        <CheckIcon
                                          className="h-5 w-5 text-amber-600"
                                          aria-hidden="true"
                                        />
                                      </span>
                                    )}
                                  </>
                                )}
                              </Listbox.Option>
                            ))
                          ) : (
                            <div className="relative cursor-default select-none py-2 pl-10 pr-4 text-gray-700">
                              No Values Found
                            </div>
                          )}
                        </Listbox.Options>
                      </Transition>
                    </div>
                  </Listbox>
                </div>
              </div>
            </div>

            <div className="d-flex gap-2">
              <div className="col-md-6">
                <div className="form-group">
                  <button
                    type="button"
                    className="w-full custom-active-button rounded-lg"
                    onClick={handleResetFilter}
                  >
                    Reset
                  </button>
                </div>
              </div>

              <div className="col-md-6">
                <div className="form-group">
                  <button
                    type="submit"
                    className="w-full custom-active-button rounded-lg"
                    onClick={handleFilterSubmit}
                  >
                    Filter
                  </button>
                </div>
              </div>
            </div>
          </form>
        </Modal.Body>
      </Modal>
    </>
  );
};

export default ExamMarkingComponent;

// Exam Marking Component done //
