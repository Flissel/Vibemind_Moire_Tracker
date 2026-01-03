/**
 * React Wrapper for MoireCanvas Web Component
 * 
 * Provides a React-friendly API for the MoireCanvas with built-in
 * WebSocket connection management.
 * 
 * @example
 * ```tsx
 * import { MoireCanvasReact } from '@moire/canvas/react';
 * 
 * function App() {
 *   return (
 *     <MoireCanvasReact
 *       wsUrl="wss://example.com/live-desktop-stream"
 *       autoConnect
 *       onBoxClick={(box) => console.log('Clicked:', box)}
 *     />
 *   );
 * }
 * ```
 */

import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  forwardRef,
  useImperativeHandle,
} from 'react';
import type { MoireCanvas as MoireCanvasElement } from '../moire-canvas';
import type { CanvasData, DetectionBox, LayerVisibility } from '../types';
import { MoireCanvasProvider, DesktopClient } from '../provider';

// Ensure Web Component is registered
import '../moire-canvas';

// ============================================================================
// Props Interface
// ============================================================================

export interface MoireCanvasReactProps {
  /** WebSocket server URL */
  wsUrl?: string;
  /** Auto-connect to WebSocket on mount (default: true if wsUrl provided) */
  autoConnect?: boolean;
  /** Auto-refresh interval in ms (default: 5000, 0 = disabled) */
  autoRefreshInterval?: number;
  /** Auto-select first available desktop (default: true) */
  autoSelectDesktop?: boolean;
  /** Initial detection data (for static use without WebSocket) */
  data?: CanvasData;
  /** Background image URL */
  backgroundImage?: string;
  /** Base URL for icon images */
  iconBaseUrl?: string;
  /** Height of the canvas container */
  height?: string | number;
  /** CSS class name */
  className?: string;
  /** Inline styles */
  style?: React.CSSProperties;
  
  // Callbacks
  /** Called when WebSocket connects */
  onConnect?: () => void;
  /** Called when WebSocket disconnects */
  onDisconnect?: () => void;
  /** Called on WebSocket error */
  onError?: (error: any) => void;
  /** Called when detection box is clicked */
  onBoxClick?: (box: DetectionBox) => void;
  /** Called when detection box is hovered */
  onBoxHover?: (box: DetectionBox | null) => void;
  /** Called when detection results are received */
  onDetectionResult?: (data: CanvasData) => void;
  /** Called when frame is received */
  onFrameReceived?: (imageUrl: string) => void;
  /** Called when desktop clients list is updated */
  onDesktopClientsUpdated?: (clients: DesktopClient[]) => void;
  /** Called when moiré toggle changes */
  onMoireToggle?: (enabled: boolean) => void;
  /** Called when layer visibility changes */
  onLayerChange?: (layer: keyof LayerVisibility, visible: boolean) => void;
  /** Called when zoom changes */
  onZoomChange?: (zoom: number) => void;
  /** Called when search is performed */
  onSearch?: (query: string, results: DetectionBox[]) => void;
  /** Called when canvas is ready */
  onReady?: () => void;
}

// ============================================================================
// Ref Interface (Imperative Handle)
// ============================================================================

export interface MoireCanvasRef {
  // Provider methods (WebSocket)
  connect: () => Promise<void>;
  disconnect: () => void;
  isConnected: () => boolean;
  getDesktopClients: () => DesktopClient[];
  selectDesktop: (clientId: string, monitorId?: string) => void;
  refreshDesktopClients: () => void;
  
  // Moiré methods
  setMoireEnabled: (enabled: boolean) => void;
  getMoireEnabled: () => boolean;
  toggleMoire: () => void;
  analyzeCurrentFrame: () => void;
  refreshCanvas: () => void;
  
  // Auto-refresh methods
  setAutoRefresh: (enabled: boolean) => void;
  getAutoRefreshEnabled: () => boolean;
  setAutoRefreshInterval: (intervalMs: number) => void;
  
  // Canvas methods
  loadBoxData: (data: CanvasData) => void;
  fitToContent: () => void;
  panTo: (x: number, y: number) => void;
  zoomTo: (level: number) => void;
  highlightBox: (boxId: number) => void;
  highlightBoxes: (boxIds: number[]) => void;
  clearHighlights: () => void;
  searchText: (query: string) => DetectionBox[];
  setLayerVisibility: (layer: keyof LayerVisibility, visible: boolean) => void;
  
  // Direct access
  getCanvas: () => MoireCanvasElement | null;
  getProvider: () => MoireCanvasProvider | null;
}

// ============================================================================
// React Component
// ============================================================================

export const MoireCanvasReact = forwardRef<MoireCanvasRef, MoireCanvasReactProps>(
  (props, ref) => {
    const {
      wsUrl,
      autoConnect = !!wsUrl,
      autoRefreshInterval = 5000,
      autoSelectDesktop = true,
      data,
      backgroundImage,
      iconBaseUrl,
      height = '100%',
      className,
      style,
      onConnect,
      onDisconnect,
      onError,
      onBoxClick,
      onBoxHover,
      onDetectionResult,
      onFrameReceived,
      onDesktopClientsUpdated,
      onMoireToggle,
      onLayerChange,
      onZoomChange,
      onSearch,
      onReady,
    } = props;

    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<MoireCanvasElement | null>(null);
    const providerRef = useRef<MoireCanvasProvider | null>(null);
    const [isReady, setIsReady] = useState(false);
    const [isConnected, setIsConnected] = useState(false);

    // Initialize canvas element
    useEffect(() => {
      if (!containerRef.current) return;

      // Create canvas element
      const canvas = document.createElement('moire-canvas') as MoireCanvasElement;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      
      containerRef.current.appendChild(canvas);
      canvasRef.current = canvas;

      // Setup canvas event listeners
      const handleBoxClick = (e: Event) => {
        const customEvent = e as CustomEvent<{ box: DetectionBox }>;
        onBoxClick?.(customEvent.detail.box);
      };

      const handleBoxHover = (e: Event) => {
        const customEvent = e as CustomEvent<{ box: DetectionBox | null }>;
        onBoxHover?.(customEvent.detail.box);
      };

      const handleMoireToggle = (e: Event) => {
        const customEvent = e as CustomEvent<{ enabled: boolean }>;
        onMoireToggle?.(customEvent.detail.enabled);
      };

      const handleLayerChange = (e: Event) => {
        const customEvent = e as CustomEvent<{ layer: keyof LayerVisibility; visible: boolean }>;
        onLayerChange?.(customEvent.detail.layer, customEvent.detail.visible);
      };

      const handleZoomChange = (e: Event) => {
        const customEvent = e as CustomEvent<{ zoom: number }>;
        onZoomChange?.(customEvent.detail.zoom);
      };

      const handleSearch = (e: Event) => {
        const customEvent = e as CustomEvent<{ query: string; results: DetectionBox[] }>;
        onSearch?.(customEvent.detail.query, customEvent.detail.results);
      };

      const handleReady = () => {
        setIsReady(true);
        onReady?.();
      };

      canvas.addEventListener('box-click', handleBoxClick);
      canvas.addEventListener('box-hover', handleBoxHover);
      canvas.addEventListener('moire-toggle', handleMoireToggle);
      canvas.addEventListener('layer-change', handleLayerChange);
      canvas.addEventListener('zoom-change', handleZoomChange);
      canvas.addEventListener('search', handleSearch);
      canvas.addEventListener('ready', handleReady);

      // Cleanup
      return () => {
        canvas.removeEventListener('box-click', handleBoxClick);
        canvas.removeEventListener('box-hover', handleBoxHover);
        canvas.removeEventListener('moire-toggle', handleMoireToggle);
        canvas.removeEventListener('layer-change', handleLayerChange);
        canvas.removeEventListener('zoom-change', handleZoomChange);
        canvas.removeEventListener('search', handleSearch);
        canvas.removeEventListener('ready', handleReady);
        
        providerRef.current?.destroy();
        providerRef.current = null;
        
        if (containerRef.current?.contains(canvas)) {
          containerRef.current.removeChild(canvas);
        }
        canvasRef.current = null;
      };
    }, []); // Only run once on mount

    // Setup WebSocket provider when canvas is ready
    useEffect(() => {
      if (!isReady || !canvasRef.current || !wsUrl) return;

      // Create provider
      const provider = new MoireCanvasProvider({
        canvas: canvasRef.current,
        wsUrl,
        autoConnect: false, // We'll connect manually
        autoRefreshInterval,
        autoSelectDesktop,
        componentName: 'react_moire_canvas',
      });

      provider
        .on('onConnect', () => {
          setIsConnected(true);
          onConnect?.();
        })
        .on('onDisconnect', () => {
          setIsConnected(false);
          onDisconnect?.();
        })
        .on('onError', (error) => {
          onError?.(error);
        })
        .on('onDetectionResult', (data) => {
          onDetectionResult?.(data);
        })
        .on('onFrameReceived', (imageUrl) => {
          onFrameReceived?.(imageUrl);
        })
        .on('onDesktopClientsUpdated', (clients) => {
          onDesktopClientsUpdated?.(clients);
        })
        .on('onBoxClick', (box) => {
          onBoxClick?.(box);
        });

      providerRef.current = provider;

      // Auto-connect if configured
      if (autoConnect) {
        provider.connect().catch((err) => {
          console.error('[MoireCanvasReact] Auto-connect failed:', err);
          onError?.(err);
        });
      }

      return () => {
        provider.destroy();
        providerRef.current = null;
      };
    }, [isReady, wsUrl, autoConnect, autoRefreshInterval, autoSelectDesktop]);

    // Update canvas attributes when props change
    useEffect(() => {
      if (!canvasRef.current) return;
      
      if (backgroundImage) {
        canvasRef.current.setAttribute('background-image', backgroundImage);
      }
      if (iconBaseUrl) {
        canvasRef.current.setAttribute('icon-base-url', iconBaseUrl);
      }
    }, [backgroundImage, iconBaseUrl]);

    // Load data when provided
    useEffect(() => {
      if (!canvasRef.current || !data) return;
      canvasRef.current.loadBoxData(data);
    }, [data]);

    // Expose imperative methods
    useImperativeHandle(ref, () => ({
      // Provider methods
      connect: async () => {
        await providerRef.current?.connect();
      },
      disconnect: () => {
        providerRef.current?.disconnect();
      },
      isConnected: () => providerRef.current?.isConnected() ?? false,
      getDesktopClients: () => providerRef.current?.getDesktopClients() ?? [],
      selectDesktop: (clientId: string, monitorId?: string) => {
        providerRef.current?.selectDesktop(clientId, monitorId);
      },
      refreshDesktopClients: () => {
        providerRef.current?.refreshDesktopClients();
      },

      // Moiré methods
      setMoireEnabled: (enabled: boolean) => {
        providerRef.current?.setMoireEnabled(enabled);
      },
      getMoireEnabled: () => providerRef.current?.getMoireEnabled() ?? false,
      toggleMoire: () => {
        providerRef.current?.toggleMoire();
      },
      analyzeCurrentFrame: () => {
        providerRef.current?.analyzeCurrentFrame();
      },
      refreshCanvas: () => {
        providerRef.current?.refreshCanvas();
      },

      // Auto-refresh methods
      setAutoRefresh: (enabled: boolean) => {
        providerRef.current?.setAutoRefresh(enabled);
      },
      getAutoRefreshEnabled: () => providerRef.current?.getAutoRefreshEnabled() ?? false,
      setAutoRefreshInterval: (intervalMs: number) => {
        providerRef.current?.setAutoRefreshInterval(intervalMs);
      },

      // Canvas methods
      loadBoxData: (data: CanvasData) => {
        canvasRef.current?.loadBoxData(data);
      },
      fitToContent: () => {
        canvasRef.current?.fitToContent();
      },
      panTo: (x: number, y: number) => {
        canvasRef.current?.panTo(x, y);
      },
      zoomTo: (level: number) => {
        canvasRef.current?.zoomTo(level);
      },
      highlightBox: (boxId: number) => {
        canvasRef.current?.highlightBox(boxId);
      },
      highlightBoxes: (boxIds: number[]) => {
        canvasRef.current?.highlightBoxes(boxIds);
      },
      clearHighlights: () => {
        canvasRef.current?.clearHighlights();
      },
      searchText: (query: string) => {
        return canvasRef.current?.searchText(query) ?? [];
      },
      setLayerVisibility: (layer: keyof LayerVisibility, visible: boolean) => {
        canvasRef.current?.setLayerVisibility(layer, visible);
      },

      // Direct access
      getCanvas: () => canvasRef.current,
      getProvider: () => providerRef.current,
    }));

    return (
      <div
        ref={containerRef}
        className={className}
        style={{
          width: '100%',
          height: typeof height === 'number' ? `${height}px` : height,
          ...style,
        }}
      />
    );
  }
);

MoireCanvasReact.displayName = 'MoireCanvasReact';

// ============================================================================
// Hook for controlling MoireCanvas
// ============================================================================

export function useMoireCanvas(ref: React.RefObject<MoireCanvasRef>) {
  const connect = useCallback(async () => {
    await ref.current?.connect();
  }, [ref]);

  const disconnect = useCallback(() => {
    ref.current?.disconnect();
  }, [ref]);

  const selectDesktop = useCallback((clientId: string, monitorId?: string) => {
    ref.current?.selectDesktop(clientId, monitorId);
  }, [ref]);

  const toggleMoire = useCallback(() => {
    ref.current?.toggleMoire();
  }, [ref]);

  const setAutoRefresh = useCallback((enabled: boolean) => {
    ref.current?.setAutoRefresh(enabled);
  }, [ref]);

  const refreshCanvas = useCallback(() => {
    ref.current?.refreshCanvas();
  }, [ref]);

  const searchText = useCallback((query: string) => {
    return ref.current?.searchText(query) ?? [];
  }, [ref]);

  const fitToContent = useCallback(() => {
    ref.current?.fitToContent();
  }, [ref]);

  return {
    connect,
    disconnect,
    selectDesktop,
    toggleMoire,
    setAutoRefresh,
    refreshCanvas,
    searchText,
    fitToContent,
    isConnected: () => ref.current?.isConnected() ?? false,
    getDesktopClients: () => ref.current?.getDesktopClients() ?? [],
    getMoireEnabled: () => ref.current?.getMoireEnabled() ?? false,
    getAutoRefreshEnabled: () => ref.current?.getAutoRefreshEnabled() ?? false,
  };
}

export default MoireCanvasReact;