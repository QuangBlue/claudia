import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Maximize2,
  Minimize2,
  ChevronUp,
  Sparkles,
  Zap,
  Square,
  Brain,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FilePicker } from "./FilePicker";
import { SlashCommandPicker } from "./SlashCommandPicker";
import { ImagePreview } from "./ImagePreview";
import { type FileEntry, type SlashCommand } from "@/lib/api";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Toast, ToastContainer } from "@/components/ui/toast";

interface FloatingPromptInputProps {
  /**
   * Callback when prompt is sent
   */
  onSend: (prompt: string, model: "sonnet" | "opus") => void;
  /**
   * Whether the input is loading
   */
  isLoading?: boolean;
  /**
   * Whether the input is disabled
   */
  disabled?: boolean;
  /**
   * Default model to select
   */
  defaultModel?: "sonnet" | "opus";
  /**
   * Project path for file picker
   */
  projectPath?: string;
  /**
   * Optional className for styling
   */
  className?: string;
  /**
   * Callback when cancel is clicked (only during loading)
   */
  onCancel?: () => void;
}

export interface FloatingPromptInputRef {
  addImage: (imagePath: string) => void;
}

/**
 * Thinking mode type definition
 */
type ThinkingMode =
  | "auto"
  | "think"
  | "think_hard"
  | "think_harder"
  | "ultrathink";

/**
 * Thinking mode configuration
 */
type ThinkingModeConfig = {
  id: ThinkingMode;
  name: string;
  description: string;
  level: number; // 0-4 for visual indicator
  phrase?: string; // The phrase to append
};

const THINKING_MODES: ThinkingModeConfig[] = [
  {
    id: "auto",
    name: "Auto",
    description: "Let Claude decide",
    level: 0,
  },
  {
    id: "think",
    name: "Think",
    description: "Basic reasoning",
    level: 1,
    phrase: "think",
  },
  {
    id: "think_hard",
    name: "Think Hard",
    description: "Deeper analysis",
    level: 2,
    phrase: "think hard",
  },
  {
    id: "think_harder",
    name: "Think Harder",
    description: "Extensive reasoning",
    level: 3,
    phrase: "think harder",
  },
  {
    id: "ultrathink",
    name: "Ultrathink",
    description: "Maximum computation",
    level: 4,
    phrase: "ultrathink",
  },
];

/**
 * ThinkingModeIndicator component - Shows visual indicator bars for thinking level
 */
const ThinkingModeIndicator: React.FC<{ level: number }> = ({ level }) => {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={cn(
            "w-1 h-3 rounded-full transition-colors",
            i <= level ? "bg-blue-500" : "bg-muted"
          )}
        />
      ))}
    </div>
  );
};

type Model = {
  id: "sonnet" | "opus";
  name: string;
  description: string;
  icon: React.ReactNode;
};

const MODELS: Model[] = [
  {
    id: "sonnet",
    name: "Claude 4 Sonnet",
    description: "Faster, efficient for most tasks",
    icon: <Zap className="h-4 w-4" />,
  },
  {
    id: "opus",
    name: "Claude 4 Opus",
    description: "More capable, better for complex tasks",
    icon: <Sparkles className="h-4 w-4" />,
  },
];

/**
 * FloatingPromptInput component - Fixed position prompt input with model picker
 *
 * @example
 * const promptRef = useRef<FloatingPromptInputRef>(null);
 * <FloatingPromptInput
 *   ref={promptRef}
 *   onSend={(prompt, model) => console.log('Send:', prompt, model)}
 *   isLoading={false}
 * />
 */
const FloatingPromptInputInner = (
  {
    onSend,
    isLoading = false,
    disabled = false,
    defaultModel = "sonnet",
    projectPath,
    className,
    onCancel,
  }: FloatingPromptInputProps,
  ref: React.Ref<FloatingPromptInputRef>
) => {
  const [prompt, setPrompt] = useState("");
  // Add separate display prompt that hides image IDs from user
  const [displayPrompt, setDisplayPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState<"sonnet" | "opus">(
    defaultModel
  );
  const [selectedThinkingMode, setSelectedThinkingMode] =
    useState<ThinkingMode>("auto");
  const [isExpanded, setIsExpanded] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [thinkingModePickerOpen, setThinkingModePickerOpen] = useState(false);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [filePickerQuery, setFilePickerQuery] = useState("");
  const [showSlashCommandPicker, setShowSlashCommandPicker] = useState(false);
  const [slashCommandQuery, setSlashCommandQuery] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [embeddedImages, setEmbeddedImages] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  // Add state to store image data separately from display text
  const [imageDataMap, setImageDataMap] = useState<Map<string, string>>(
    new Map()
  );
  const [showVSCodeToast, setShowVSCodeToast] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const expandedTextareaRef = useRef<HTMLTextAreaElement>(null);
  const unlistenDragDropRef = useRef<(() => void) | null>(null);

  // Helper function to generate a short unique ID for images
  const generateImageId = (): string => {
    return `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  // Debug helper function
  const debugCurrentState = (source: string) => {
    console.log(`[DEBUG ${source}] Prompt length: ${prompt.length}`);
    console.log(
      `[DEBUG ${source}] Display prompt length: ${displayPrompt.length}`
    );
    console.log(
      `[DEBUG ${source}] ImageDataMap size: ${imageDataMap.size}, keys:`,
      Array.from(imageDataMap.keys())
    );
    console.log(
      `[DEBUG ${source}] EmbeddedImages count: ${embeddedImages.length}`
    );

    // Check for image IDs in prompt
    const quotedRegex = /@"([^"]+)"/g;
    const idsInPrompt: string[] = [];
    let match;
    while ((match = quotedRegex.exec(prompt)) !== null) {
      const path = match[1];
      if (path.startsWith("img_")) {
        idsInPrompt.push(path);
      }
    }
    console.log(`[DEBUG ${source}] Image IDs in prompt:`, idsInPrompt);
  };

  // Function to create display prompt with image placeholders
  const createDisplayPrompt = (actualPrompt: string): string => {
    let display = actualPrompt;

    // Replace image IDs with user-friendly placeholders
    for (const [imageId, imageData] of imageDataMap.entries()) {
      const imageIdPattern = new RegExp(
        `@"${imageId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
        "g"
      );
      display = display.replace(imageIdPattern, `📷 [Image]`);
    }

    return display;
  };

  // Function to convert display prompt back to actual prompt for processing
  const convertDisplayToActual = (display: string): string => {
    // This will be handled by maintaining the actual prompt separately
    // Display prompt is just for viewing, actual prompt handles logic
    return prompt; // Return the actual prompt, not the display one
  };

  // Update display prompt when actual prompt or imageDataMap changes
  useEffect(() => {
    const newDisplayPrompt = createDisplayPrompt(prompt);
    if (newDisplayPrompt !== displayPrompt) {
      setDisplayPrompt(newDisplayPrompt);
    }
  }, [prompt, imageDataMap]);

  // Expose a method to add images programmatically
  React.useImperativeHandle(
    ref,
    () => ({
      addImage: (imagePath: string) => {
        setPrompt((currentPrompt) => {
          const existingPaths = extractImagePaths(currentPrompt);

          // For base64 data URLs, check if already added by comparing actual data
          if (imagePath.startsWith("data:")) {
            if (existingPaths.includes(imagePath)) {
              return currentPrompt; // Image already added
            }

            // Generate an ID for this base64 image
            const imageId = generateImageId();

            // Store the base64 data in our map
            setImageDataMap((prev) => {
              const newMap = new Map(prev);
              newMap.set(imageId, imagePath);
              return newMap;
            });

            // Use the image ID in the actual prompt
            const mention = `@"${imageId}"`;
            const newActualPrompt =
              currentPrompt +
              (currentPrompt.endsWith(" ") || currentPrompt === "" ? "" : " ") +
              mention +
              " ";

            // Update display prompt with placeholder
            setDisplayPrompt((currentDisplayPrompt) => {
              const displayMention = `📷 [Image]`;
              return (
                currentDisplayPrompt +
                (currentDisplayPrompt.endsWith(" ") ||
                currentDisplayPrompt === ""
                  ? ""
                  : " ") +
                displayMention +
                " "
              );
            });

            // Focus the textarea
            setTimeout(() => {
              const target = isExpanded
                ? expandedTextareaRef.current
                : textareaRef.current;
              target?.focus();
              target?.setSelectionRange(
                newActualPrompt.length,
                newActualPrompt.length
              );
            }, 0);

            return newActualPrompt;
          }

          // For file paths, use existing logic
          if (existingPaths.includes(imagePath)) {
            return currentPrompt; // Image already added
          }

          // Wrap path in quotes if it contains spaces
          const mention = imagePath.includes(" ")
            ? `@"${imagePath}"`
            : `@${imagePath}`;
          const newPrompt =
            currentPrompt +
            (currentPrompt.endsWith(" ") || currentPrompt === "" ? "" : " ") +
            mention +
            " ";

          // For file paths, display and actual are the same
          setDisplayPrompt((currentDisplayPrompt) => {
            return (
              currentDisplayPrompt +
              (currentDisplayPrompt.endsWith(" ") || currentDisplayPrompt === ""
                ? ""
                : " ") +
              mention +
              " "
            );
          });

          // Focus the textarea
          setTimeout(() => {
            const target = isExpanded
              ? expandedTextareaRef.current
              : textareaRef.current;
            target?.focus();
            target?.setSelectionRange(newPrompt.length, newPrompt.length);
          }, 0);

          return newPrompt;
        });
      },
    }),
    [isExpanded, imageDataMap]
  );

  // Helper function to check if a file is an image
  const isImageFile = (path: string): boolean => {
    // Check if it's a data URL
    if (path.startsWith("data:image/")) {
      return true;
    }
    // Otherwise check file extension
    const ext = path.split(".").pop()?.toLowerCase();
    return ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"].includes(
      ext || ""
    );
  };

  // Extract all file paths from prompt text (not just images)
  const extractAllFilePaths = (text: string): string[] => {
    console.log(
      "[extractAllFilePaths] Input text:",
      text.substring(0, 100) + (text.length > 100 ? "..." : "")
    );
    console.log("[extractAllFilePaths] imageDataMap size:", imageDataMap.size);

    // Updated regex to handle both quoted and unquoted paths
    // Pattern 1: @"path with spaces or data URLs or image IDs" - quoted paths
    // Pattern 2: @path - unquoted paths (continues until @ or end)
    const quotedRegex = /@"([^"]+)"/g;
    const unquotedRegex = /@([^@\n\s]+)/g;

    const pathsSet = new Set<string>(); // Use Set to ensure uniqueness

    // First, extract quoted paths (including data URLs and image IDs)
    let matches = Array.from(text.matchAll(quotedRegex));
    console.log("[extractAllFilePaths] Quoted matches:", matches.length);

    for (const match of matches) {
      const path = match[1]; // No need to trim, quotes preserve exact path
      console.log(
        "[extractAllFilePaths] Processing quoted path:",
        path.startsWith("data:")
          ? "data URL"
          : path.startsWith("img_")
          ? `image ID: ${path}`
          : `file path: ${path}`
      );

      // Check if it's an image ID in our map
      if (path.startsWith("img_") && imageDataMap.has(path)) {
        const actualImageData = imageDataMap.get(path)!;
        console.log(
          "[extractAllFilePaths] Found image ID in map, using actual data"
        );
        pathsSet.add(actualImageData);
        continue;
      }

      // For data URLs, use as-is; for file paths, convert to absolute
      const fullPath = path.startsWith("data:")
        ? path
        : path.startsWith("/")
        ? path
        : projectPath
        ? `${projectPath}/${path}`
        : path;

      // Accept all file types, not just images
      console.log(
        "[extractAllFilePaths] Added file path:",
        fullPath.startsWith("data:") ? "data URL" : fullPath
      );
      pathsSet.add(fullPath);
    }

    // Remove quoted mentions from text to avoid double-matching
    let textWithoutQuoted = text.replace(quotedRegex, "");

    // Then extract unquoted paths (typically file paths)
    matches = Array.from(textWithoutQuoted.matchAll(unquotedRegex));
    console.log("[extractAllFilePaths] Unquoted matches:", matches.length);

    for (const match of matches) {
      const path = match[1].trim();
      // Skip if it looks like a data URL fragment or image ID (shouldn't happen with proper quoting)
      if (path.includes("data:") || path.startsWith("img_")) {
        console.log(
          "[extractAllFilePaths] Skipping unquoted data/imageId:",
          path.substring(0, 20)
        );
        continue;
      }

      console.log("[extractAllFilePaths] Processing unquoted path:", path);

      // Convert relative path to absolute if needed
      const fullPath = path.startsWith("/")
        ? path
        : projectPath
        ? `${projectPath}/${path}`
        : path;

      // Accept all file types
      console.log("[extractAllFilePaths] Added unquoted file path:", fullPath);
      pathsSet.add(fullPath);
    }

    const uniquePaths = Array.from(pathsSet);
    console.log(
      "[extractAllFilePaths] Final result:",
      uniquePaths.length,
      "unique paths"
    );
    return uniquePaths;
  };

  // Extract image paths from prompt text
  const extractImagePaths = (text: string): string[] => {
    console.log(
      "[extractImagePaths] Input text:",
      text.substring(0, 100) + (text.length > 100 ? "..." : "")
    );
    console.log("[extractImagePaths] imageDataMap size:", imageDataMap.size);

    // Updated regex to handle both quoted and unquoted paths
    // Pattern 1: @"path with spaces or data URLs or image IDs" - quoted paths
    // Pattern 2: @path - unquoted paths (continues until @ or end)
    const quotedRegex = /@"([^"]+)"/g;
    const unquotedRegex = /@([^@\n\s]+)/g;

    const pathsSet = new Set<string>(); // Use Set to ensure uniqueness

    // First, extract quoted paths (including data URLs and image IDs)
    let matches = Array.from(text.matchAll(quotedRegex));
    console.log("[extractImagePaths] Quoted matches:", matches.length);

    for (const match of matches) {
      const path = match[1]; // No need to trim, quotes preserve exact path
      console.log(
        "[extractImagePaths] Processing quoted path:",
        path.startsWith("data:")
          ? "data URL"
          : path.startsWith("img_")
          ? `image ID: ${path}`
          : `file path: ${path}`
      );

      // Check if it's an image ID in our map
      if (path.startsWith("img_") && imageDataMap.has(path)) {
        const actualImageData = imageDataMap.get(path)!;
        console.log(
          "[extractImagePaths] Found image ID in map, using actual data"
        );
        pathsSet.add(actualImageData);
        continue;
      }

      // For data URLs, use as-is; for file paths, convert to absolute
      const fullPath = path.startsWith("data:")
        ? path
        : path.startsWith("/")
        ? path
        : projectPath
        ? `${projectPath}/${path}`
        : path;

      if (isImageFile(fullPath)) {
        console.log(
          "[extractImagePaths] Added image path:",
          fullPath.startsWith("data:") ? "data URL" : fullPath
        );
        pathsSet.add(fullPath);
      }
    }

    // Remove quoted mentions from text to avoid double-matching
    let textWithoutQuoted = text.replace(quotedRegex, "");

    // Then extract unquoted paths (typically file paths)
    matches = Array.from(textWithoutQuoted.matchAll(unquotedRegex));
    console.log("[extractImagePaths] Unquoted matches:", matches.length);

    for (const match of matches) {
      const path = match[1].trim();
      // Skip if it looks like a data URL fragment or image ID (shouldn't happen with proper quoting)
      if (path.includes("data:") || path.startsWith("img_")) {
        console.log(
          "[extractImagePaths] Skipping unquoted data/imageId:",
          path.substring(0, 20)
        );
        continue;
      }

      console.log("[extractImagePaths] Processing unquoted path:", path);

      // Convert relative path to absolute if needed
      const fullPath = path.startsWith("/")
        ? path
        : projectPath
        ? `${projectPath}/${path}`
        : path;

      if (isImageFile(fullPath)) {
        console.log("[extractImagePaths] Added unquoted image path:", fullPath);
        pathsSet.add(fullPath);
      }
    }

    const uniquePaths = Array.from(pathsSet);
    console.log(
      "[extractImagePaths] Final result:",
      uniquePaths.length,
      "unique paths"
    );
    return uniquePaths;
  };

  // Update embedded images when prompt changes
  useEffect(() => {
    console.log(
      "[useEffect:extractImages] Prompt changed:",
      prompt.length,
      "chars"
    );
    const imagePaths = extractImagePaths(prompt);
    console.log(
      "[useEffect:extractImages] Extracted image paths:",
      imagePaths.length
    );

    // Only update if there's actually a change to avoid unnecessary re-renders
    const currentPathsStr = embeddedImages.join("|");
    const newPathsStr = imagePaths.join("|");

    if (currentPathsStr !== newPathsStr) {
      console.log(
        "[useEffect:extractImages] Image paths changed, updating embeddedImages"
      );
      setEmbeddedImages(imagePaths);
    }
  }, [prompt, projectPath]);

  // Clean up imageDataMap when image IDs are removed from prompt
  useEffect(() => {
    if (imageDataMap.size === 0) return;

    console.log(
      "[useEffect:cleanupImages] Checking for cleanup, map size:",
      imageDataMap.size
    );

    // Find image IDs still in prompt
    const quotedRegex = /@"([^"]+)"/g;
    const imageIdsInPrompt = new Set<string>();
    let match;
    const tempPrompt = prompt; // Create temp var to avoid re-running regex exec
    while ((match = quotedRegex.exec(tempPrompt)) !== null) {
      const path = match[1];
      if (path.startsWith("img_")) {
        imageIdsInPrompt.add(path);
      }
    }

    // Remove any image IDs from map that are no longer in prompt
    const currentImageIds = Array.from(imageDataMap.keys());
    const idsToRemove = currentImageIds.filter(
      (id) => !imageIdsInPrompt.has(id)
    );

    if (idsToRemove.length > 0) {
      console.log(
        "[useEffect:cleanupImages] Cleaning up unused image IDs:",
        idsToRemove
      );
      setImageDataMap((prev) => {
        const newMap = new Map(prev);
        idsToRemove.forEach((id) => newMap.delete(id));
        return newMap;
      });
    }
  }, [prompt, imageDataMap]); // This useEffect can safely depend on imageDataMap

  // Set up Tauri drag-drop event listener
  useEffect(() => {
    // This effect runs only once on component mount to set up the listener.
    let lastDropTime = 0;

    const setupListener = async () => {
      try {
        // If a listener from a previous mount/render is still around, clean it up.
        if (unlistenDragDropRef.current) {
          unlistenDragDropRef.current();
        }

        const webview = getCurrentWebviewWindow();
        unlistenDragDropRef.current = await webview.onDragDropEvent((event) => {
          if (event.payload.type === "enter" || event.payload.type === "over") {
            setDragActive(true);
          } else if (event.payload.type === "leave") {
            setDragActive(false);
          } else if (event.payload.type === "drop") {
            setDragActive(false);

            const currentTime = Date.now();
            if (currentTime - lastDropTime < 200) {
              // This debounce is crucial to handle the storm of drop events
              // that Tauri/OS can fire for a single user action.
              return;
            }
            lastDropTime = currentTime;

            // Handle both cases: with paths and without paths
            const droppedPaths = (event.payload.paths as string[]) || [];

            // Debug: Log the drag source and paths
            console.log("[DRAG DEBUG] Drop event received:");
            console.log("[DRAG DEBUG] Paths count:", droppedPaths.length);
            console.log("[DRAG DEBUG] Raw paths:", droppedPaths);
            console.log("[DRAG DEBUG] Event payload:", event.payload);

            // Check if this might be a VSCode drag (no paths provided)
            if (droppedPaths.length === 0) {
              console.log(
                "[DRAG DEBUG] No paths provided - likely VSCode drag"
              );

              // Show a helpful message to user
              console.warn(
                "[DRAG] VSCode drag detected: VSCode doesn't provide file paths in drag & drop. Please use @ to mention files or drag from Finder instead."
              );

              // Show toast notification
              setShowVSCodeToast(true);
              return;
            }

            // Check if paths exist and are accessible
            droppedPaths.forEach((path, index) => {
              console.log(`[DRAG DEBUG] Path ${index}:`, {
                originalPath: path,
                pathType: typeof path,
                pathLength: path.length,
                isAbsolute: path.startsWith("/"),
                exists: path ? "path provided" : "no path",
                platform: navigator.platform,
              });
            });

            // Normalize and filter file paths
            const filePaths = droppedPaths
              .map((path) => {
                // Handle different path formats
                let normalizedPath = path;

                // Remove file:// URI scheme if present
                if (normalizedPath.startsWith("file://")) {
                  normalizedPath = decodeURIComponent(
                    normalizedPath.replace("file://", "")
                  );
                }

                // Handle VSCode specific URIs
                if (normalizedPath.includes("vscode://")) {
                  console.log(
                    "[DRAG DEBUG] VSCode URI detected:",
                    normalizedPath
                  );
                  // VSCode URIs need special handling - might not be droppable files
                  return null;
                }

                // Ensure absolute path
                if (!normalizedPath.startsWith("/") && projectPath) {
                  normalizedPath = `${projectPath}/${normalizedPath}`;
                }

                console.log("[DRAG DEBUG] Path normalization:", {
                  original: path,
                  normalized: normalizedPath,
                });

                return normalizedPath;
              })
              .filter((path) => path !== null) as string[];

            if (filePaths.length > 0) {
              console.log("[DRAG DEBUG] Processing file paths...");

              setPrompt((currentPrompt) => {
                console.log(
                  "[DRAG DEBUG] Current prompt length:",
                  currentPrompt.length
                );

                // Extract all file paths from current prompt (not just images)
                const existingPaths = extractAllFilePaths(currentPrompt);
                console.log(
                  "[DRAG DEBUG] Existing paths in prompt:",
                  existingPaths
                );

                const newPaths = filePaths.filter(
                  (p) => !existingPaths.includes(p)
                );
                console.log("[DRAG DEBUG] New paths to add:", newPaths);

                if (newPaths.length === 0) {
                  console.log(
                    "[DRAG DEBUG] All files already in prompt, skipping"
                  );
                  return currentPrompt; // All dropped files are already in the prompt
                }

                // Wrap paths with spaces in quotes for clarity
                const mentionsToAdd = newPaths
                  .map((p) => {
                    // If path contains spaces, wrap in quotes
                    const mention = p.includes(" ") ? `@"${p}"` : `@${p}`;
                    console.log("[DRAG DEBUG] Created mention:", mention);
                    return mention;
                  })
                  .join(" ");

                console.log(
                  "[DRAG DEBUG] Final mentions to add:",
                  mentionsToAdd
                );

                const newPrompt =
                  currentPrompt +
                  (currentPrompt.endsWith(" ") || currentPrompt === ""
                    ? ""
                    : " ") +
                  mentionsToAdd +
                  " ";

                console.log(
                  "[DRAG DEBUG] New prompt length:",
                  newPrompt.length
                );
                console.log(
                  "[DRAG DEBUG] New prompt preview:",
                  newPrompt.substring(newPrompt.length - 100)
                );

                setTimeout(() => {
                  const target = isExpanded
                    ? expandedTextareaRef.current
                    : textareaRef.current;
                  target?.focus();
                  target?.setSelectionRange(newPrompt.length, newPrompt.length);
                }, 0);

                return newPrompt;
              });
            } else {
              console.log("[DRAG DEBUG] No file paths to process");
            }
          }
        });
      } catch (error) {
        console.error("Failed to set up Tauri drag-drop listener:", error);
      }
    };

    setupListener();

    return () => {
      // On unmount, ensure we clean up the listener.
      if (unlistenDragDropRef.current) {
        unlistenDragDropRef.current();
        unlistenDragDropRef.current = null;
      }
    };
  }, []); // Empty dependency array ensures this runs only on mount/unmount.

  useEffect(() => {
    // Focus the appropriate textarea when expanded state changes
    if (isExpanded && expandedTextareaRef.current) {
      expandedTextareaRef.current.focus();
    } else if (!isExpanded && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isExpanded]);

  // Reset textarea height when display prompt is cleared
  useEffect(() => {
    if (textareaRef.current) {
      if (displayPrompt === "") {
        textareaRef.current.style.height = "44px";
      } else {
        // Recalculate height for existing content
        const textarea = textareaRef.current;
        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
      }
    }
  }, [displayPrompt]);

  const handleSend = () => {
    if (displayPrompt.trim() && !disabled) {
      let finalPrompt = prompt.trim(); // Use actual prompt, not display prompt

      // Replace image IDs with actual base64 data before sending
      for (const [imageId, imageData] of imageDataMap.entries()) {
        const imageIdPattern = new RegExp(
          `@"${imageId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
          "g"
        );
        finalPrompt = finalPrompt.replace(imageIdPattern, `@"${imageData}"`);
      }

      // Append thinking phrase if not auto mode
      const thinkingMode = THINKING_MODES.find(
        (m) => m.id === selectedThinkingMode
      );
      if (thinkingMode && thinkingMode.phrase) {
        finalPrompt = `${finalPrompt}.\n\n${thinkingMode.phrase}.`;
      }

      onSend(finalPrompt, selectedModel);
      setPrompt("");
      setDisplayPrompt("");
      setEmbeddedImages([]);
      // Clear the image data map when prompt is sent
      setImageDataMap(new Map());
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newDisplayValue = e.target.value;
    const newCursorPosition = e.target.selectionStart || 0;

    debugCurrentState("handleTextChange-START");
    console.log(
      "[handleTextChange] Old display value length:",
      displayPrompt.length,
      "New display value length:",
      newDisplayValue.length
    );

    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;

    // Update display prompt
    setDisplayPrompt(newDisplayValue);

    // Convert display changes back to actual prompt
    // For now, we'll reconstruct the actual prompt by preserving image IDs and updating text around them
    let newActualPrompt = newDisplayValue;

    // Replace image placeholders back with their IDs if they still exist in the display
    const placeholderRegex = /📷 \[Image\]/g;
    const imageIds = Array.from(imageDataMap.keys());
    let imageIndex = 0;

    newActualPrompt = newDisplayValue.replace(placeholderRegex, () => {
      if (imageIndex < imageIds.length) {
        return `@"${imageIds[imageIndex++]}"`;
      }
      return "📷 [Image]"; // Fallback if more placeholders than IDs
    });

    // If user removed some image placeholders, we need to clean up the corresponding IDs
    const remainingPlaceholders = (
      newDisplayValue.match(placeholderRegex) || []
    ).length;
    if (remainingPlaceholders < imageDataMap.size) {
      // Remove excess image IDs
      const idsToKeep = imageIds.slice(0, remainingPlaceholders);
      const newImageDataMap = new Map();
      idsToKeep.forEach((id) => {
        if (imageDataMap.has(id)) {
          newImageDataMap.set(id, imageDataMap.get(id)!);
        }
      });
      setImageDataMap(newImageDataMap);

      // Rebuild actual prompt with only kept IDs
      newActualPrompt = newDisplayValue;
      let index = 0;
      newActualPrompt = newDisplayValue.replace(placeholderRegex, () => {
        if (index < idsToKeep.length) {
          return `@"${idsToKeep[index++]}"`;
        }
        return "📷 [Image]";
      });
    }

    setPrompt(newActualPrompt);

    // Check if / was just typed at the beginning of input or after whitespace
    if (
      newDisplayValue.length > displayPrompt.length &&
      newDisplayValue[newCursorPosition - 1] === "/"
    ) {
      // Check if it's at the start or after whitespace
      const isStartOfCommand =
        newCursorPosition === 1 ||
        (newCursorPosition > 1 &&
          /\s/.test(newDisplayValue[newCursorPosition - 2]));

      if (isStartOfCommand) {
        console.log("[FloatingPromptInput] / detected for slash command");
        setShowSlashCommandPicker(true);
        setSlashCommandQuery("");
        setCursorPosition(newCursorPosition);
      }
    }

    // Check if @ was just typed
    if (
      projectPath?.trim() &&
      newDisplayValue.length > displayPrompt.length &&
      newDisplayValue[newCursorPosition - 1] === "@"
    ) {
      console.log(
        "[FloatingPromptInput] @ detected, projectPath:",
        projectPath
      );
      setShowFilePicker(true);
      setFilePickerQuery("");
      setCursorPosition(newCursorPosition);
    }

    // Check if we're typing after / (for slash command search)
    if (showSlashCommandPicker && newCursorPosition >= cursorPosition) {
      // Find the / position before cursor
      let slashPosition = -1;
      for (let i = newCursorPosition - 1; i >= 0; i--) {
        if (newDisplayValue[i] === "/") {
          slashPosition = i;
          break;
        }
        // Stop if we hit whitespace (new word)
        if (newDisplayValue[i] === " " || newDisplayValue[i] === "\n") {
          break;
        }
      }

      if (slashPosition !== -1) {
        const query = newDisplayValue.substring(
          slashPosition + 1,
          newCursorPosition
        );
        setSlashCommandQuery(query);
      } else {
        // / was removed or cursor moved away
        setShowSlashCommandPicker(false);
        setSlashCommandQuery("");
      }
    }

    // Check if we're typing after @ (for search query)
    if (showFilePicker && newCursorPosition >= cursorPosition) {
      // Find the @ position before cursor
      let atPosition = -1;
      for (let i = newCursorPosition - 1; i >= 0; i--) {
        if (newDisplayValue[i] === "@") {
          atPosition = i;
          break;
        }
        // Stop if we hit whitespace (new word)
        if (newDisplayValue[i] === " " || newDisplayValue[i] === "\n") {
          break;
        }
      }

      if (atPosition !== -1) {
        const query = newDisplayValue.substring(
          atPosition + 1,
          newCursorPosition
        );
        setFilePickerQuery(query);
      } else {
        // @ was removed or cursor moved away
        setShowFilePicker(false);
        setFilePickerQuery("");
      }
    }

    setCursorPosition(newCursorPosition);

    // Debug state after changes
    setTimeout(() => debugCurrentState("handleTextChange-END"), 0);
  };

  const handleFileSelect = (entry: FileEntry) => {
    if (textareaRef.current) {
      // Find the @ position before cursor in display prompt
      let atPosition = -1;
      for (let i = cursorPosition - 1; i >= 0; i--) {
        if (displayPrompt[i] === "@") {
          atPosition = i;
          break;
        }
        // Stop if we hit whitespace (new word)
        if (displayPrompt[i] === " " || displayPrompt[i] === "\n") {
          break;
        }
      }

      if (atPosition === -1) {
        // @ not found, this shouldn't happen but handle gracefully
        console.error("[FloatingPromptInput] @ position not found");
        return;
      }

      // Replace the @ and partial query with the selected path (file or directory)
      const textarea = textareaRef.current;
      const beforeAt = displayPrompt.substring(0, atPosition);
      const afterCursor = displayPrompt.substring(cursorPosition);
      const relativePath = entry.path.startsWith(projectPath || "")
        ? entry.path.slice((projectPath || "").length + 1)
        : entry.path;

      const newDisplayPrompt = `${beforeAt}@${relativePath} ${afterCursor}`;
      setDisplayPrompt(newDisplayPrompt);

      // Also update actual prompt
      const newActualPrompt = newDisplayPrompt; // For file paths, display and actual are the same
      setPrompt(newActualPrompt);

      setShowFilePicker(false);
      setFilePickerQuery("");

      // Focus back on textarea and set cursor position after the inserted path
      setTimeout(() => {
        textarea.focus();
        const newCursorPos = beforeAt.length + relativePath.length + 2; // +2 for @ and space
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    }
  };

  const handleFilePickerClose = () => {
    setShowFilePicker(false);
    setFilePickerQuery("");
    // Return focus to textarea
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  };

  const handleSlashCommandSelect = (command: SlashCommand) => {
    const textarea = isExpanded
      ? expandedTextareaRef.current
      : textareaRef.current;
    if (!textarea) return;

    // Find the / position before cursor in display prompt
    let slashPosition = -1;
    for (let i = cursorPosition - 1; i >= 0; i--) {
      if (displayPrompt[i] === "/") {
        slashPosition = i;
        break;
      }
      // Stop if we hit whitespace (new word)
      if (displayPrompt[i] === " " || displayPrompt[i] === "\n") {
        break;
      }
    }

    if (slashPosition === -1) {
      console.error("[FloatingPromptInput] / position not found");
      return;
    }

    // Simply insert the command syntax
    const beforeSlash = displayPrompt.substring(0, slashPosition);
    const afterCursor = displayPrompt.substring(cursorPosition);

    if (command.accepts_arguments) {
      // Insert command with placeholder for arguments
      const newDisplayPrompt = `${beforeSlash}${command.full_command} `;
      setDisplayPrompt(newDisplayPrompt);
      setPrompt(newDisplayPrompt); // For slash commands, display and actual are the same
      setShowSlashCommandPicker(false);
      setSlashCommandQuery("");

      // Focus and position cursor after the command
      setTimeout(() => {
        textarea.focus();
        const newCursorPos =
          beforeSlash.length + command.full_command.length + 1;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    } else {
      // Insert command and close picker
      const newDisplayPrompt = `${beforeSlash}${command.full_command} ${afterCursor}`;
      setDisplayPrompt(newDisplayPrompt);
      setPrompt(newDisplayPrompt); // For slash commands, display and actual are the same
      setShowSlashCommandPicker(false);
      setSlashCommandQuery("");

      // Focus and position cursor after the command
      setTimeout(() => {
        textarea.focus();
        const newCursorPos =
          beforeSlash.length + command.full_command.length + 1;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    }
  };

  const handleSlashCommandPickerClose = () => {
    setShowSlashCommandPicker(false);
    setSlashCommandQuery("");
    // Return focus to textarea
    setTimeout(() => {
      const textarea = isExpanded
        ? expandedTextareaRef.current
        : textareaRef.current;
      textarea?.focus();
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showFilePicker && e.key === "Escape") {
      e.preventDefault();
      setShowFilePicker(false);
      setFilePickerQuery("");
      return;
    }

    if (showSlashCommandPicker && e.key === "Escape") {
      e.preventDefault();
      setShowSlashCommandPicker(false);
      setSlashCommandQuery("");
      return;
    }

    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !isExpanded &&
      !showFilePicker &&
      !showSlashCommandPicker
    ) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        console.log("[handlePaste] Image detected, processing...");

        // Get the image blob
        const blob = item.getAsFile();
        if (!blob) continue;

        try {
          // Generate a unique ID for this image instead of using the full base64
          const imageId = generateImageId();
          console.log("[handlePaste] Generated image ID:", imageId);

          // Convert blob to base64 asynchronously
          const reader = new FileReader();
          reader.onload = () => {
            const base64Data = reader.result as string;
            console.log(
              "[handlePaste] Base64 conversion complete, length:",
              base64Data.length
            );

            // Store the base64 data in our map
            setImageDataMap((prev) => {
              const newMap = new Map(prev);
              newMap.set(imageId, base64Data);
              console.log(
                "[handlePaste] Added to imageDataMap, new size:",
                newMap.size
              );
              return newMap;
            });

            // Add only the short ID to the prompt for better performance
            setPrompt((currentPrompt) => {
              const mention = `@"${imageId}"`;
              const newPrompt =
                currentPrompt +
                (currentPrompt.endsWith(" ") || currentPrompt === ""
                  ? ""
                  : " ") +
                mention +
                " ";

              console.log(
                "[handlePaste] Updated prompt, new length:",
                newPrompt.length
              );
              console.log("[handlePaste] Added mention:", mention);

              // Also update display prompt with user-friendly placeholder
              setDisplayPrompt((currentDisplayPrompt) => {
                const displayMention = `📷 [Image]`;
                const newDisplayPrompt =
                  currentDisplayPrompt +
                  (currentDisplayPrompt.endsWith(" ") ||
                  currentDisplayPrompt === ""
                    ? ""
                    : " ") +
                  displayMention +
                  " ";
                console.log(
                  "[handlePaste] Updated display prompt, new length:",
                  newDisplayPrompt.length
                );
                return newDisplayPrompt;
              });

              // Focus the textarea and move cursor to end
              setTimeout(() => {
                const target = isExpanded
                  ? expandedTextareaRef.current
                  : textareaRef.current;
                target?.focus();
                target?.setSelectionRange(newPrompt.length, newPrompt.length);
              }, 0);

              return newPrompt;
            });
          };

          reader.readAsDataURL(blob);
        } catch (error) {
          console.error("Failed to paste image:", error);
        }
      }
    }
  };

  // Browser drag and drop handlers - just prevent default behavior
  // Actual file handling is done via Tauri's window-level drag-drop events
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Visual feedback is handled by Tauri events
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // File processing is handled by Tauri's onDragDropEvent
  };

  const handleRemoveImage = (index: number) => {
    // Remove the corresponding @mention from the prompt
    const imagePath = embeddedImages[index];

    // Find the corresponding image ID in the prompt if this is a base64 image
    let imageIdToRemove: string | null = null;

    // Check if this image path is a base64 that came from an image ID
    for (const [imageId, imageData] of imageDataMap.entries()) {
      if (imageData === imagePath) {
        imageIdToRemove = imageId;
        break;
      }
    }

    if (imageIdToRemove) {
      // Remove the image ID from the prompt
      const quotedPath = `@"${imageIdToRemove}"`;
      const newPrompt = prompt.replace(quotedPath, "").trim();
      setPrompt(newPrompt);

      // Clean up the image data map
      setImageDataMap((prev) => {
        const newMap = new Map(prev);
        newMap.delete(imageIdToRemove!);
        return newMap;
      });
      return;
    }

    // For data URLs pasted directly, we need to handle them specially since they're always quoted
    if (imagePath.startsWith("data:")) {
      // Simply remove the exact quoted data URL
      const quotedPath = `@"${imagePath}"`;
      const newPrompt = prompt.replace(quotedPath, "").trim();
      setPrompt(newPrompt);
      return;
    }

    // For file paths, use the original logic
    const escapedPath = imagePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedRelativePath = imagePath
      .replace(projectPath + "/", "")
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Create patterns for both quoted and unquoted mentions
    const patterns = [
      // Quoted full path
      new RegExp(`@"${escapedPath}"\\s?`, "g"),
      // Unquoted full path
      new RegExp(`@${escapedPath}\\s?`, "g"),
      // Quoted relative path
      new RegExp(`@"${escapedRelativePath}"\\s?`, "g"),
      // Unquoted relative path
      new RegExp(`@${escapedRelativePath}\\s?`, "g"),
    ];

    let newPrompt = prompt;
    for (const pattern of patterns) {
      newPrompt = newPrompt.replace(pattern, "");
    }

    setPrompt(newPrompt.trim());
  };

  const selectedModelData =
    MODELS.find((m) => m.id === selectedModel) || MODELS[0];

  return (
    <>
      {/* Toast Container */}
      <ToastContainer>
        {showVSCodeToast && (
          <Toast
            message="VSCode drag not supported. Use @ to mention files or drag from Finder instead."
            type="info"
            duration={4000}
            onDismiss={() => setShowVSCodeToast(false)}
          />
        )}
      </ToastContainer>

      {/* Expanded Modal */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
            onClick={() => setIsExpanded(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-background border border-border rounded-lg shadow-lg w-full max-w-2xl p-4 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Compose your prompt</h3>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsExpanded(false)}
                  className="h-8 w-8"
                >
                  <Minimize2 className="h-4 w-4" />
                </Button>
              </div>

              {/* Image previews in expanded mode */}
              {embeddedImages.length > 0 && (
                <ImagePreview
                  images={embeddedImages}
                  onRemove={handleRemoveImage}
                  className="border-t border-border pt-2"
                />
              )}

              <Textarea
                ref={expandedTextareaRef}
                value={displayPrompt}
                onChange={handleTextChange}
                onPaste={handlePaste}
                placeholder="Type your prompt here..."
                className="min-h-[400px] max-h-[800px] resize-none overflow-auto"
                disabled={disabled}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Model:
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setModelPickerOpen(!modelPickerOpen)}
                      className="gap-2"
                    >
                      {selectedModelData.icon}
                      {selectedModelData.name}
                    </Button>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Thinking:
                    </span>
                    <Popover
                      trigger={
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setThinkingModePickerOpen(
                                    !thinkingModePickerOpen
                                  )
                                }
                                className="gap-2"
                              >
                                <Brain className="h-4 w-4" />
                                <ThinkingModeIndicator
                                  level={
                                    THINKING_MODES.find(
                                      (m) => m.id === selectedThinkingMode
                                    )?.level || 0
                                  }
                                />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="font-medium">
                                {THINKING_MODES.find(
                                  (m) => m.id === selectedThinkingMode
                                )?.name || "Auto"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {
                                  THINKING_MODES.find(
                                    (m) => m.id === selectedThinkingMode
                                  )?.description
                                }
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      }
                      content={
                        <div className="w-[280px] p-1">
                          {THINKING_MODES.map((mode) => (
                            <button
                              key={mode.id}
                              onClick={() => {
                                setSelectedThinkingMode(mode.id);
                                setThinkingModePickerOpen(false);
                              }}
                              className={cn(
                                "w-full flex items-start gap-3 p-3 rounded-md transition-colors text-left",
                                "hover:bg-accent",
                                selectedThinkingMode === mode.id && "bg-accent"
                              )}
                            >
                              <Brain className="h-4 w-4 mt-0.5" />
                              <div className="flex-1 space-y-1">
                                <div className="font-medium text-sm">
                                  {mode.name}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {mode.description}
                                </div>
                              </div>
                              <ThinkingModeIndicator level={mode.level} />
                            </button>
                          ))}
                        </div>
                      }
                      open={thinkingModePickerOpen}
                      onOpenChange={setThinkingModePickerOpen}
                      align="start"
                      side="top"
                    />
                  </div>
                </div>

                <Button
                  onClick={handleSend}
                  disabled={!displayPrompt.trim() || disabled}
                  size="default"
                  className="min-w-[60px]"
                >
                  {isLoading ? (
                    <div className="rotating-symbol text-primary-foreground" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fixed Position Input Bar */}
      <div
        className={cn(
          "fixed bottom-0 left-0 right-0 z-40 bg-background border-t border-border",
          dragActive && "ring-2 ring-primary ring-offset-2",
          className
        )}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <div className="max-w-5xl mx-auto">
          <div className="pl-4 pr-4 pt-2 pb-2">
            {/* Image previews */}
            {embeddedImages.length > 0 && (
              <ImagePreview
                images={embeddedImages}
                onRemove={handleRemoveImage}
                className="border-b border-border"
              />
            )}
            <div className="mb-2">
              {/* Prompt Input */}
              <div className="flex-1 relative">
                <Textarea
                  ref={textareaRef}
                  value={displayPrompt}
                  onChange={handleTextChange}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder={
                    dragActive ? "Drop files here..." : "Ask Claude anything..."
                  }
                  disabled={disabled}
                  className={cn(
                    "min-h-[100px] max-h-[300px] resize-none pr-10 overflow-auto"
                  )}
                  rows={1}
                  style={{
                    backgroundColor: "var(--color-card)",
                    border:
                      "1px solid color-mix(in srgb, var(--color-foreground) 12%, transparent)",
                  }}
                />

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsExpanded(true)}
                  disabled={disabled}
                  className="absolute right-1 bottom-1 h-8 w-8"
                >
                  <Maximize2 className="h-4 w-4" />
                </Button>

                {/* File Picker */}
                <AnimatePresence>
                  {showFilePicker && projectPath && projectPath.trim() && (
                    <FilePicker
                      basePath={projectPath.trim()}
                      onSelect={handleFileSelect}
                      onClose={handleFilePickerClose}
                      initialQuery={filePickerQuery}
                    />
                  )}
                </AnimatePresence>

                {/* Slash Command Picker */}
                <AnimatePresence>
                  {showSlashCommandPicker && (
                    <SlashCommandPicker
                      projectPath={projectPath}
                      onSelect={handleSlashCommandSelect}
                      onClose={handleSlashCommandPickerClose}
                      initialQuery={slashCommandQuery}
                    />
                  )}
                </AnimatePresence>
              </div>
            </div>
            <div className="flex items-end gap-3">
              {/* Model Picker */}
              <Popover
                trigger={
                  <Button
                    variant="outline"
                    size="default"
                    disabled={disabled}
                    className="gap-2 min-w-[180px] justify-start"
                  >
                    {selectedModelData.icon}
                    <span className="flex-1 text-left">
                      {selectedModelData.name}
                    </span>
                    <ChevronUp className="h-4 w-4 opacity-50" />
                  </Button>
                }
                content={
                  <div className="w-[300px] p-1">
                    {MODELS.map((model) => (
                      <button
                        key={model.id}
                        onClick={() => {
                          setSelectedModel(model.id);
                          setModelPickerOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-start gap-3 p-3 rounded-md transition-colors text-left",
                          "hover:bg-accent",
                          selectedModel === model.id && "bg-accent"
                        )}
                      >
                        <div className="mt-0.5">{model.icon}</div>
                        <div className="flex-1 space-y-1">
                          <div className="font-medium text-sm">
                            {model.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {model.description}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                }
                open={modelPickerOpen}
                onOpenChange={setModelPickerOpen}
                align="start"
                side="top"
              />

              {/* Thinking Mode Picker */}
              <Popover
                trigger={
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="default"
                          disabled={disabled}
                          className="gap-2"
                        >
                          <Brain className="h-4 w-4" />
                          <ThinkingModeIndicator
                            level={
                              THINKING_MODES.find(
                                (m) => m.id === selectedThinkingMode
                              )?.level || 0
                            }
                          />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-medium">
                          {THINKING_MODES.find(
                            (m) => m.id === selectedThinkingMode
                          )?.name || "Auto"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {
                            THINKING_MODES.find(
                              (m) => m.id === selectedThinkingMode
                            )?.description
                          }
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                }
                content={
                  <div className="w-[280px] p-1">
                    {THINKING_MODES.map((mode) => (
                      <button
                        key={mode.id}
                        onClick={() => {
                          setSelectedThinkingMode(mode.id);
                          setThinkingModePickerOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-start gap-3 p-3 rounded-md transition-colors text-left",
                          "hover:bg-accent",
                          selectedThinkingMode === mode.id && "bg-accent"
                        )}
                      >
                        <Brain className="h-4 w-4 mt-0.5" />
                        <div className="flex-1 space-y-1">
                          <div className="font-medium text-sm">{mode.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {mode.description}
                          </div>
                        </div>
                        <ThinkingModeIndicator level={mode.level} />
                      </button>
                    ))}
                  </div>
                }
                open={thinkingModePickerOpen}
                onOpenChange={setThinkingModePickerOpen}
                align="start"
                side="top"
              />
              <div className="flex-1" />
              {/* Send/Stop Button */}
              <Button
                onClick={isLoading ? onCancel : handleSend}
                disabled={isLoading ? false : !displayPrompt.trim() || disabled}
                variant={isLoading ? "destructive" : "default"}
                size="sm"
                className="min-w-[60px] shrink-0"
              >
                {isLoading ? (
                  <>
                    <Square className="h-4 w-4 mr-1" />
                    Stop
                  </>
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>

            <div className="mt-2 text-xs text-muted-foreground">
              Press Enter to send, Shift+Enter for new line
              {projectPath?.trim() &&
                ", @ to mention files, / for commands, drag & drop files or paste images"}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export const FloatingPromptInput = React.forwardRef<
  FloatingPromptInputRef,
  FloatingPromptInputProps
>(FloatingPromptInputInner);

FloatingPromptInput.displayName = "FloatingPromptInput";
